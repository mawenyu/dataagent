package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 需求1: 把 OpenCode session 历史（/api/session/{id}/message）转换为
 * AG-UI Message[]，供前端切换会话时回放。
 *
 * <p>映射：user→user；assistant 的 reasoning part→role:"reasoning" 消息、
 * text part→assistant content、tool part→assistant.toolCalls + 后续
 * role:"tool" 结果消息（结果取 state.content[] 的文本，截断 2k）。</p>
 */
@Service
public class ThreadMessagesService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int TOOL_RESULT_MAX = 2000;
    /** P-M: 从 gateway 注入 prompt 的 <attachments> 段还原附件文件名(导出清单用)。 */
    private static final Pattern ATTACHMENTS_BLOCK = Pattern.compile(
            "(?s)<attachments>\\s*用户随消息上传了文件:\\s*(.+?)（已保存");

    /** P-M: 消息级时间戳(ms epoch → ISO 字符串),无则不写。 */
    private void putCreatedAt(JsonNode m, ObjectNode msg) {
        long created = m.path("time").path("created").asLong(0);
        if (created > 0) msg.put("createdAt", Instant.ofEpochMilli(created).toString());
    }

    private List<String> extractAttachments(String wrappedText) {
        if (wrappedText == null) return List.of();
        Matcher m = ATTACHMENTS_BLOCK.matcher(wrappedText);
        if (!m.find()) return List.of();
        return Arrays.stream(m.group(1).split(",\\s*"))
                .map(String::trim).filter(x -> !x.isEmpty()).toList();
    }

    /**
     * 历史拉取共享段：GET /api/session/{sid}/message → {@link #toAguiMessages}。
     * 调用方各自决定错误兜底（branch 空列表 / messages 带 surfaces 空历史 /
     * MESSAGES_SNAPSHOT 跳过发送，语义不同故不在此统一）。
     */
    public Mono<List<JsonNode>> fetchAguiMessages(WebClient webClient, String sessionId) {
        return webClient.get()
                .uri("/api/session/{sid}/message", sessionId)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .map(this::toAguiMessages);
    }

    public List<JsonNode> toAguiMessages(String historyJson) {
        List<JsonNode> out = new ArrayList<>();
        if (historyJson == null || historyJson.isBlank()) return out;
        JsonNode root;
        try {
            root = MAPPER.readTree(historyJson);
        } catch (Exception e) {
            return out;
        }
        JsonNode data = root.path("data");
        if (!data.isArray()) return out;
        // 实测：OpenCode /api/session/{id}/message 返回最新在前，翻转为时间正序
        List<JsonNode> newestFirst = new ArrayList<>();
        data.forEach(newestFirst::add);
        for (int i = newestFirst.size() - 1; i >= 0; i--) {
            convert(newestFirst.get(i), out);
        }
        return dedupeAbortedRetry(out);
    }

    /**
     * P18: 断线/失败续跑的服务端残留去重 —— 中断轮的 user 消息与重发的同文
     * 消息相邻（中间无 assistant 正文）时折叠前者（reasoning/tool 痕迹保留，
     * 它们是真实运行轨迹）。有完整 assistant 回答的重复提问不折叠。
     */
    static List<JsonNode> dedupeAbortedRetry(List<JsonNode> msgs) {
        List<JsonNode> out = new ArrayList<>(msgs);
        for (int i = 0; i < out.size(); i++) {
            JsonNode m = out.get(i);
            if (!"user".equals(m.path("role").asText())) continue;
            String text = m.path("content").asText("");
            if (text.isBlank()) continue;
            // 向后找下一条 user；中间出现带正文的 assistant → 不折叠
            boolean assistantBetween = false;
            int j = i + 1;
            for (; j < out.size(); j++) {
                JsonNode n = out.get(j);
                String role = n.path("role").asText();
                if ("assistant".equals(role) && !n.path("content").asText("").isBlank()) {
                    assistantBetween = true;
                    break;
                }
                if ("user".equals(role)) break;
            }
            if (!assistantBetween && j < out.size()
                    && "user".equals(out.get(j).path("role").asText())
                    && text.equals(out.get(j).path("content").asText(""))) {
                out.remove(i);
                i--; // 重查当前位（后续仍可能连环折叠）
            }
        }
        return out;
    }

    private void convert(JsonNode m, List<JsonNode> out) {
        String type = m.path("type").asText("");
        String id = m.path("id").asText("");
        JsonNode content = m.path("content");
        switch (type) {
            case "user" -> {
                StringBuilder sb = new StringBuilder();
                for (JsonNode p : content) {
                    if ("text".equals(p.path("type").asText())) {
                        if (sb.length() > 0) sb.append('\n');
                        sb.append(p.path("text").asText(""));
                    }
                }
                // 实测：OpenCode 用户消息的文本在 m.text（content 为空数组），
                // 且含 gateway 注入的 <environment>/<user_message> 包装，需还原
                if (sb.length() == 0) sb.append(unwrapUserPrompt(m.path("text").asText("")));
                if (sb.length() == 0) return;
                ObjectNode msg = MAPPER.createObjectNode();
                msg.put("id", id);
                msg.put("role", "user");
                msg.put("content", sb.toString());
                // P-M: 消息时间戳 + 附件清单(从 prompt 包装的 <attachments> 段还原)
                putCreatedAt(m, msg);
                List<String> attachments = extractAttachments(m.path("text").asText(""));
                if (!attachments.isEmpty()) {
                    ArrayNode arr = msg.putArray("attachments");
                    attachments.forEach(arr::add);
                }
                out.add(msg);
            }
            case "assistant" -> {
                if (!content.isArray()) return;
                ObjectNode assistant = null;
                ArrayNode toolCalls = null;
                List<JsonNode> toolResults = new ArrayList<>();
                for (JsonNode p : content) {
                    switch (p.path("type").asText("")) {
                        case "reasoning" -> {
                            String text = p.path("text").asText("");
                            if (!text.isBlank()) {
                                ObjectNode r = MAPPER.createObjectNode();
                                r.put("id", id + "-" + p.path("id").asText("r"));
                                r.put("role", "reasoning");
                                r.put("content", text);
                                out.add(r);
                            }
                        }
                        case "text" -> {
                            if (assistant == null) {
                                assistant = MAPPER.createObjectNode();
                                assistant.put("id", id);
                                assistant.put("role", "assistant");
                                assistant.put("content", "");
                            }
                            String cur = assistant.path("content").asText();
                            String delta = p.path("text").asText("");
                            if (!delta.isBlank()) {
                                assistant.put("content", cur.isEmpty() ? delta : cur + "\n" + delta);
                            }
                        }
                        case "tool" -> {
                            if (assistant == null) {
                                assistant = MAPPER.createObjectNode();
                                assistant.put("id", id);
                                assistant.put("role", "assistant");
                                assistant.put("content", "");
                            }
                            if (toolCalls == null) {
                                toolCalls = MAPPER.createArrayNode();
                                assistant.set("toolCalls", toolCalls);
                            }
                            String callId = p.path("id").asText();
                            ObjectNode fn = MAPPER.createObjectNode();
                            fn.put("name", p.path("name").asText(""));
                            fn.put("arguments", p.path("state").path("input").toString());
                            ObjectNode tc = MAPPER.createObjectNode();
                            tc.put("id", callId);
                            tc.put("type", "function");
                            tc.set("function", fn);
                            // P-M: 工具耗时(part.time: ran→completed)与结果状态
                            long ranAt = p.path("time").path("ran").asLong(0);
                            long started = ranAt > 0 ? ranAt : p.path("time").path("created").asLong(0);
                            long completedAt = p.path("time").path("completed").asLong(0);
                            if (completedAt > 0 && started > 0 && completedAt >= started) {
                                tc.put("durationMs", completedAt - started);
                            }
                            String toolStatus = p.path("state").path("status").asText("");
                            if (!toolStatus.isBlank()) tc.put("status", toolStatus);
                            toolCalls.add(tc);

                            ObjectNode result = MAPPER.createObjectNode();
                            result.put("id", "toolres-" + callId);
                            result.put("role", "tool");
                            result.put("toolCallId", callId);
                            result.put("content", toolResultText(p));
                            toolResults.add(result);
                        }
                        default -> { /* step/synthetic 等跳过 */ }
                    }
                }
                if (assistant != null) {
                    putCreatedAt(m, assistant); // P-M
                    out.add(assistant);
                }
                out.addAll(toolResults);
            }
            default -> { /* system/model-switched 等跳过 */ }
        }
    }

    /**
     * P-Q: 分叉前缀 —— 截断到 messageId(不含该消息),保留 user/assistant
     * 文本消息(reasoning/tool 不进分叉上下文),单条截断 2000、最多 50 条。
     */
    public List<Map<String, String>> simplifyForFork(List<JsonNode> messages, String messageId) {
        List<Map<String, String>> out = new ArrayList<>();
        for (JsonNode m : messages) {
            if (m.path("id").asText().equals(messageId)) break;
            String role = m.path("role").asText();
            if (!"user".equals(role) && !"assistant".equals(role)) continue;
            String content = m.path("content").asText("");
            if (content.isBlank()) continue;
            if (content.length() > 2000) content = content.substring(0, 2000) + "…";
            out.add(Map.of("id", m.path("id").asText(), "role", role, "content", content));
            if (out.size() >= 50) break;
        }
        return out;
    }

    /** 还原 gateway 的 prompt 包装：剥掉 <environment> 段、解包 <user_message>。 */
    private String unwrapUserPrompt(String text) {
        if (text == null || text.isBlank()) return "";
        String s = text.replaceAll("(?s)<environment>.*?</environment>", "").trim();
        java.util.regex.Matcher um = java.util.regex.Pattern
                .compile("(?s)<user_message>\\s*(.*?)\\s*</user_message>").matcher(s);
        if (um.find()) s = um.group(1);
        return s.trim();
    }

    private String toolResultText(JsonNode toolPart) {
        JsonNode state = toolPart.path("state");
        String status = state.path("status").asText("unknown");
        StringBuilder sb = new StringBuilder();
        for (JsonNode c : state.path("content")) {
            if ("text".equals(c.path("type").asText())) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(c.path("text").asText(""));
            }
        }
        if (sb.length() == 0 && state.path("structured").isObject() && !state.path("structured").isEmpty()) {
            sb.append(state.path("structured").toString());
        }
        if (sb.length() == 0) sb.append("(").append(status).append(")");
        String s = sb.toString();
        return s.length() > TOOL_RESULT_MAX ? s.substring(0, TOOL_RESULT_MAX) + "…(截断)" : s;
    }
}
