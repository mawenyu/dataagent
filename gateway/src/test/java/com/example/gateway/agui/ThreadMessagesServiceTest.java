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
}
