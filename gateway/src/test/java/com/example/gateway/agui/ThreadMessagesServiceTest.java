package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 需求1: OpenCode session 历史 → AG-UI Message[] 转换（切换会话后前端回放）。
 */
class ThreadMessagesServiceTest {

    private final ThreadMessagesService svc = new ThreadMessagesService();

    @Test
    void convertsUserAssistantReasoningAndTools() {
        // 注意：OpenCode /message 返回最新在前（assistant 在 user 之前）
        String history = """
            {"data":[
              {"id":"a1","type":"assistant","content":[
                {"type":"reasoning","id":"r1","text":"先看数据"},
                {"type":"text","id":"t0","text":"结论如下"},
                {"type":"tool","id":"call_1","name":"bash","state":{"status":"completed","input":{"command":"ls"},"content":[{"type":"text","text":"sales.csv"}]}}
              ]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"分析销售"}]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        assertEquals(4, msgs.size());
        assertEquals("user", msgs.get(0).path("role").asText());
        assertEquals("分析销售", msgs.get(0).path("content").asText());
        assertEquals("reasoning", msgs.get(1).path("role").asText());
        assertEquals("先看数据", msgs.get(1).path("content").asText());
        JsonNode assistant = msgs.get(2);
        assertEquals("assistant", assistant.path("role").asText());
        assertEquals("结论如下", assistant.path("content").asText());
        assertEquals("call_1", assistant.path("toolCalls").get(0).path("id").asText());
        assertEquals("bash", assistant.path("toolCalls").get(0).path("function").path("name").asText());
        assertTrue(assistant.path("toolCalls").get(0).path("function").path("arguments").asText().contains("ls"));
        JsonNode tool = msgs.get(3);
        assertEquals("tool", tool.path("role").asText());
        assertEquals("call_1", tool.path("toolCallId").asText());
        assertEquals("sales.csv", tool.path("content").asText());
    }

    @Test
    void runningOrFailedToolGetsStatusText() {
        String history = """
            {"data":[
              {"id":"a1","type":"assistant","content":[
                {"type":"tool","id":"c1","name":"read","state":{"status":"running","input":{"path":"/x"}}}
              ]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        JsonNode tool = msgs.get(1);
        assertEquals("tool", tool.path("role").asText());
        assertTrue(tool.path("content").asText().contains("running"), "non-completed state surfaced");
    }

    @Test
    void emptyAndMalformedHistoryYieldEmpty() {
        assertTrue(svc.toAguiMessages("").isEmpty());
        assertTrue(svc.toAguiMessages("not json").isEmpty());
        assertTrue(svc.toAguiMessages("{\"data\":[]}").isEmpty());
    }

    @Test
    void multiPartUserTextJoined() {
        String history = """
            {"data":[{"id":"u1","type":"user","content":[{"type":"text","text":"第一段"},{"type":"text","text":"第二段"}]}]}
            """;
        assertEquals("第一段\n第二段", svc.toAguiMessages(history).get(0).path("content").asText());
    }

    /** 实测：OpenCode 用户消息的 text 在 m.text，且含 gateway 注入的 prompt 包装，需还原。 */
    @Test
    void userTextFieldUnwrappedFromPromptEnvelope() {
        String history = """
            {"data":[{"id":"u1","type":"user","text":"<environment>\\n数据工作目录: /x\\n</environment>\\n\\n<user_message>\\n分析本月销售情况\\n</user_message>"}]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        assertEquals(1, msgs.size());
        assertEquals("user", msgs.get(0).path("role").asText());
        assertEquals("分析本月销售情况", msgs.get(0).path("content").asText());
    }

    /** 实测：OpenCode /message 返回最新在前，AG-UI 需要时间正序。 */
    @Test
    void historyIsReversedToChronologicalOrder() {
        String history = """
            {"data":[
              {"id":"a1","type":"assistant","content":[{"type":"text","id":"t","text":"回答"}]},
              {"id":"u1","type":"user","text":"问题"}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        assertEquals("user", msgs.get(0).path("role").asText());
        assertEquals("assistant", msgs.get(1).path("role").asText());
    }

    @Test
    void bareUserTextWithoutEnvelopePassesThrough() {
        String history = """
            {"data":[{"id":"u1","type":"user","text":"直接的话"}]}
            """;
        assertEquals("直接的话", svc.toAguiMessages(history).get(0).path("content").asText());
    }

    @Test
    void pmFields_createdAtDurationStatusAttachments() {
        // P-M: 导出增强需要 —— 消息时间戳 / 工具耗时与状态 / 用户附件清单
        String history = """
            {"data":[
              {"id":"a1","type":"assistant","time":{"created":1786806287752,"completed":1786806288859},"content":[
                {"type":"text","id":"t0","text":"结论"},
                {"type":"tool","id":"call_1","name":"shell","time":{"created":1786806287833,"ran":1786806288259,"completed":1786806288723},"state":{"status":"completed","input":{"command":"ls"},"content":[{"type":"text","text":"ok"}]}}
              ]},
              {"id":"u1","type":"user","time":{"created":1786806283431},"text":"<environment>\\n数据工作目录: x\\n</environment>\\n\\n<attachments>\\n用户随消息上传了文件: a.csv, b.xlsx（已保存到数据工作目录，直接用工具读取分析）\\n</attachments>\\n\\n<user_message>\\n分析这两个文件\\n</user_message>","content":[]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        JsonNode user = msgs.get(0);
        assertTrue(user.path("createdAt").asText("").startsWith("2026-"), "user createdAt ISO");
        assertEquals("a.csv", user.path("attachments").get(0).asText());
        assertEquals("b.xlsx", user.path("attachments").get(1).asText());
        // <attachments> 段不混入正文
        assertEquals("分析这两个文件", user.path("content").asText());

        JsonNode assistant = msgs.get(1);
        assertTrue(assistant.path("createdAt").asText("").startsWith("2026-"));
        JsonNode tc = assistant.path("toolCalls").get(0);
        assertEquals(464, tc.path("durationMs").asLong(), "completed - ran");
        assertEquals("completed", tc.path("status").asText());
    }

    /** P18: 断线续跑残留去重 —— 中断轮的 user 消息与重发的相同消息相邻
     *  （中间无 assistant 正文）→ 折叠为一条。 */
    @org.junit.jupiter.api.Test
    void abortedTurnDuplicateUserMessageCollapsed() {
        String history = """
            {"data":[
              {"id":"a2","type":"assistant","content":[{"type":"text","id":"t2","text":"行数 137"}]},
              {"id":"u2","type":"user","content":[{"type":"text","text":"统计行数"}]},
              {"id":"r1","type":"assistant","content":[{"type":"reasoning","id":"r1","text":"中断前的半截推理"}]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"统计行数"}]},
              {"id":"a0","type":"assistant","content":[{"type":"text","id":"t0","text":"之前的回答"}]},
              {"id":"u0","type":"user","content":[{"type":"text","text":"你好"}]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        long userCount = msgs.stream().filter(m -> "user".equals(m.path("role").asText())).count();
        assertEquals(2, userCount, "中断轮重发折叠：你好 + 统计行数 各一条");
        // 最终答案仍在（无丢失）
        assertTrue(msgs.stream().anyMatch(m -> "行数 137".equals(m.path("content").asText())));
        // 中断轮的半截 reasoning 痕迹保留（真实轨迹，不算重复）
        assertTrue(msgs.stream().anyMatch(m -> "reasoning".equals(m.path("role").asText())));
    }

    /** 有意的重复提问（中间有完整 assistant 回答）不得折叠。 */
    @org.junit.jupiter.api.Test
    void intentionalRepeatPreserved() {
        String history = """
            {"data":[
              {"id":"a2","type":"assistant","content":[{"type":"text","id":"t2","text":"答案B"}]},
              {"id":"u2","type":"user","content":[{"type":"text","text":"再算一遍"}]},
              {"id":"a1","type":"assistant","content":[{"type":"text","id":"t1","text":"答案A"}]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"再算一遍"}]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        long userCount = msgs.stream().filter(m -> "user".equals(m.path("role").asText())).count();
        assertEquals(2, userCount, "有完整回答的重复提问保留");
    }

    /**
     * 2026-08-16 线上 bug（spreadsheetEdits modal 不弹）根因修复：
     * 伪 {@code <tool_call>} 纯标记消息进入 OpenCode 历史后是裸文本，
     * MESSAGES_SNAPSHOT 以历史为权威冲刷客户端消息流 → 流式发出的
     * TOOL_CALL_* 被抹掉，浏览器永不执行 frontend tool handler。
     * 历史转换必须把标记还原成 toolCalls（AG-UI 语义），并把标记从正文剔除。
     */
    @Test
    void pureToolCallMarkerTextBecomesToolCalls() {
        String history = """
            {"data":[
              {"id":"m1","type":"assistant","content":[
                {"type":"text","id":"t0","text":"<tool_call>{\\\"name\\\":\\\"applySpreadsheetEdits\\\",\\\"arguments\\\":{\\\"file\\\":\\\"sales.csv\\\",\\\"cells\\\":[{\\\"row\\\":1,\\\"col\\\":5,\\\"value\\\":\\\"999999\\\"}]}}</tool_call>"}
              ]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"改销售额"}]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        assertEquals(2, msgs.size());
        JsonNode assistant = msgs.get(1);
        assertEquals("assistant", assistant.path("role").asText());
        assertEquals("", assistant.path("content").asText(), "标记不得残留为可见文本");
        JsonNode tc = assistant.path("toolCalls").get(0);
        assertEquals("function", tc.path("type").asText());
        assertFalse(tc.path("id").asText().isBlank(), "快照 toolCall 需要非空 id");
        assertEquals("applySpreadsheetEdits", tc.path("function").path("name").asText());
        JsonNode args;
        try {
            args = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(tc.path("function").path("arguments").asText());
        } catch (Exception e) {
            fail("arguments 必须是 JSON 字符串: " + e.getMessage());
            return;
        }
        assertEquals("sales.csv", args.path("file").asText());
        assertEquals("999999", args.path("cells").get(0).path("value").asText());
    }

    /** 引导文本 + 标记混排：引导文本保留为正文，标记转 toolCalls。 */
    @Test
    void guideTextBeforeMarkerPreservedAsContent() {
        String history = """
            {"data":[
              {"id":"m1","type":"assistant","content":[
                {"type":"text","id":"t0","text":"好的，我来修改\\n<tool_call>{\\\"name\\\":\\\"showNotification\\\",\\\"arguments\\\":{\\\"message\\\":\\\"hi\\\"}}</tool_call>"}
              ]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        JsonNode assistant = msgs.get(0);
        assertEquals("好的，我来修改", assistant.path("content").asText());
        assertEquals("showNotification", assistant.path("toolCalls").get(0).path("function").path("name").asText());
    }

    /** DeepSeek 伪 DSML 尾巴（无 </tool_call> 结束标签）也要能还原。 */
    @Test
    void markerWithDsmlTailStillParsed() {
        String history = """
            {"data":[
              {"id":"m1","type":"assistant","content":[
                {"type":"text","id":"t0","text":"<tool_call>{\\\"name\\\":\\\"showNotification\\\",\\\"arguments\\\":{\\\"message\\\":\\\"hi\\\"}}</｜DSML｜parameter>"}
              ]}
            ]}
            """;
        List<JsonNode> msgs = svc.toAguiMessages(history);
        JsonNode assistant = msgs.get(0);
        assertEquals("", assistant.path("content").asText());
        assertEquals("showNotification", assistant.path("toolCalls").get(0).path("function").path("name").asText());
    }
}
