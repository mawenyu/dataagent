package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

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
                if (assistant != null) out.add(assistant);
                out.addAll(toolResults);
            }
            default -> { /* system/model-switched 等跳过 */ }
        }
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
