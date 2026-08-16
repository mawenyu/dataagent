package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Frontend-tool bridge (AG-UI client-side tools over OpenCode).
 *
 * <p>This OpenCode version runs its LLM turns through the v2 core runner,
 * which only exposes built-in tools — neither per-request tool definitions
 * nor .opencode/tool custom tools reach the model. The gateway therefore
 * implements the AG-UI frontend-tool contract at the prompt level:
 *
 * <ol>
 *   <li>When {@code RunAgentInput.tools} is non-empty, the tool schemas are
 *       injected into the prompt with a strict output contract: to call a tool
 *       the model must reply with exactly one {@code <tool_call>{...}</tool_call>}
 *       block and nothing else ({@link #buildPrompt}).</li>
 *   <li>{@link AguiEventTranslator} detects that block (lookahead buffer at the
 *       start of each assistant message) and converts it into standard AG-UI
 *       TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END events instead of
 *       streaming it as text, then ends the run. The browser executes the
 *       tool.</li>
 *   <li>The client sends a new RunAgentInput whose last message is
 *       {@code role: "tool"}; {@link #buildContinuationPrompt} turns the tool
 *       result into a synthetic prompt so the agent continues naturally.</li>
 * </ol>
 */
@Service
public class FrontendToolBridge {

    private static final Logger log = LoggerFactory.getLogger(FrontendToolBridge.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String MARKER = "<tool_call>";
    public static final String END_MARKER = "</tool_call>";

    // Loose input-validation thresholds (security: interface reserved, no auth — see TASK §16)
    private static final int MAX_TOOLS = 32;
    private static final int MAX_TOOL_SCHEMA_CHARS = 16 * 1024;

    /** Parsed {@code <tool_call>} payload. */
    public record ToolCallRequest(String name, JsonNode arguments) {}

    /** Tools declared by the browser in this run (already size-validated). */
    public List<Map<String, Object>> sanitizeTools(List<Map<String, Object>> tools) {
        if (tools == null) return List.of();
        return tools.stream()
                .limit(MAX_TOOLS)
                .filter(t -> t.get("name") instanceof String n && n.matches("[A-Za-z0-9_\\-]{1,64}"))
                .filter(t -> {
                    try {
                        return MAPPER.writeValueAsString(t).length() <= MAX_TOOL_SCHEMA_CHARS;
                    } catch (Exception e) {
                        return false;
                    }
                })
                .toList();
    }

    /** Last message is a tool result -> build the continuation prompt. */
    public Optional<String> buildContinuationPrompt(List<Map<String, Object>> messages) {
        if (messages == null || messages.isEmpty()) return Optional.empty();
        Map<String, Object> last = messages.get(messages.size() - 1);
        if (!"tool".equals(String.valueOf(last.get("role")))) return Optional.empty();

        String toolCallId = String.valueOf(last.get("toolCallId"));
        String content = String.valueOf(last.get("content"));
        String name = null;
        String arguments = null;
        // find the matching assistant toolCall for context
        for (int i = messages.size() - 2; i >= 0; i--) {
            Map<String, Object> m = messages.get(i);
            if (!"assistant".equals(String.valueOf(m.get("role")))) continue;
            Object calls = m.get("toolCalls");
            if (!(calls instanceof List<?> list)) continue;
            for (Object c : list) {
                if (!(c instanceof Map<?, ?> call)) continue;
                if (!toolCallId.equals(String.valueOf(call.get("id")))) continue;
                Object fn = call.get("function");
                if (fn instanceof Map<?, ?> f) {
                    name = String.valueOf(f.get("name"));
                    arguments = String.valueOf(f.get("arguments"));
                }
            }
            if (name != null) break;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("[client tool result] The client-side tool \"")
                .append(name != null ? name : toolCallId)
                .append("\" was executed in the user's browser.\n");
        if (arguments != null) sb.append("Arguments: ").append(arguments).append('\n');
        sb.append("Result: ").append(content).append('\n');
        sb.append("Continue the conversation naturally for the user based on this result. ")
                .append("Do not call the same tool again for the same request.");
        log.info("continuation prompt built for toolCallId={}", toolCallId);
        return Optional.of(sb.toString());
    }

    /**
     * The client-tools prompt section (empty string when no tools). The caller
     * wraps it together with any server-tool section and the user message.
     */
    public String buildClientToolsSection(List<Map<String, Object>> tools) {
        if (tools.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("<client_tools>\n");
        sb.append("You can call the following client-side tools. They are executed by the user's browser, not by you.\n");
        // 2026-08-15 实测：工具原生注册后模型会把 client tool 当原生工具/CodeMode
        // 调（Unknown tool 重试循环）—— 显式禁止
        sb.append("They are NOT registered on the server: NEVER invoke them as native tool calls or via CodeMode/execute. The ONLY way to call them is the text block below.\n");
        sb.append("To call a client tool, your ENTIRE response MUST be exactly one block in this form, with no other text before or after it, and no markdown fences:\n");
        sb.append(MARKER).append("{\"name\": \"<tool name>\", \"arguments\": { ... }}").append(END_MARKER).append('\n');
        sb.append("The arguments object must conform to the tool's JSON schema. If no client tool is needed, answer normally and do not output the marker.\n");
        // P27: 审计发现模型偶发绕过 HITL 用原生 edit 直改 CSV —— 提示词层显式约束
        // （约束力有边界，gateway 侧另有风险文件警告回执兜底观测）。
        boolean hasSpreadsheetTool = tools.stream()
                .anyMatch(t -> String.valueOf(t.get("name")).toLowerCase().contains("spreadsheet"));
        if (hasSpreadsheetTool) {
            sb.append("Modifying data files (CSV/TSV/XLSX) MUST go through the applySpreadsheetEdits client tool, ")
                    .append("so the user can review and confirm the exact changes before anything is written. ")
                    .append("NEVER use native file tools (edit/write) to modify such files directly, ")
                    .append("even if the user's request sounds like a simple in-place edit.\n");
        }
        sb.append("Available client tools:\n");
        for (Map<String, Object> t : tools) {
            sb.append("- name: ").append(t.get("name")).append('\n');
            Object desc = t.get("description");
            if (desc != null) sb.append("  description: ").append(desc).append('\n');
            Object params = t.get("parameters");
            if (params != null) {
                try {
                    sb.append("  parameters: ").append(MAPPER.writeValueAsString(params)).append('\n');
                } catch (Exception e) {
                    log.warn("tool {} parameters not serializable", t.get("name"));
                }
            }
        }
        sb.append("</client_tools>");
        return sb.toString();
    }

    /**
     * Parse a completed assistant text buffer into a tool call.
     * Tolerates surrounding whitespace and accidental markdown fences.
     *
     * <p>2026-08-15 实测：DeepSeek 会把结束标签输出成 DSML 伪标签
     * （{@code </｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke>}，全角竖线）而不是
     * {@code </tool_call>}。因此不再要求块以 END_MARKER 结尾 —— 剥掉 MARKER
     * 前缀后，在 END_MARKER 或 DSML 尾巴标签处截断，中间即 JSON payload。
     */
    public Optional<ToolCallRequest> parseToolCall(String text) {
        if (text == null) return Optional.empty();
        String s = text.strip();
        if (s.startsWith("```")) {
            int nl = s.indexOf('\n');
            if (nl > 0) s = s.substring(nl + 1);
            if (s.endsWith("```")) s = s.substring(0, s.length() - 3);
            s = s.strip();
        }
        if (!s.startsWith(MARKER)) return Optional.empty();
        String rest = s.substring(MARKER.length());
        int end = rest.indexOf(END_MARKER);
        int dsml = dsmlTailIndex(rest);
        if (end < 0 || (dsml >= 0 && dsml < end)) end = dsml;
        String json = (end >= 0 ? rest.substring(0, end) : rest).strip();
        if (json.isEmpty()) return Optional.empty();
        try {
            JsonNode node = MAPPER.readTree(json);
            String name = node.path("name").asText("");
            if (name.isBlank()) return Optional.empty();
            JsonNode args = node.path("arguments");
            return Optional.of(new ToolCallRequest(name, args.isMissingNode() || args.isNull()
                    ? MAPPER.createObjectNode() : args));
        } catch (Exception e) {
            log.warn("failed to parse tool_call payload: {}", e.getMessage());
            return Optional.empty();
        }
    }

    /** DSML 伪尾巴标签（{@code </｜DSML｜...>} 半/全角竖线、单/双竖线变体）的位置；无则 -1。 */
    static int dsmlTailIndex(String s) {
        var m = java.util.regex.Pattern.compile("</[|｜]+DSML[|｜]+").matcher(s);
        return m.find() ? m.start() : -1;
    }

    /**
     * Whether {@code buf} can still grow into a tool-call marker (used for the
     * streaming lookahead at the start of an assistant message).
     */
    public boolean couldBecomeMarker(String buf) {
        String t = buf.stripLeading();
        if (t.startsWith("```")) {
            int nl = t.indexOf('\n');
            if (nl < 0) return "```json".startsWith(t); // still on the fence line
            t = t.substring(nl + 1).stripLeading();
        }
        if (t.isEmpty()) return true;
        return MARKER.startsWith(t)      // prefix of the marker: keep buffering
                || t.startsWith(MARKER); // full marker seen: it IS a tool call, keep suppressing
    }
}
