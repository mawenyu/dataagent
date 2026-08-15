package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * vision-P3: HITL interrupt/resume —— request_user_confirm 服务端工具
 * （spec: docs/spec/a2ui-agui-extensions.md）。agent 调用即中断本轮输出
 * 一张确认卡片（WarningCard + 确认/取消 ActionButton），用户点击经
 * a2uiAction 通道作为新 run 续跑（真实 agent，非 Java 假分支）。
 */
class HitlConfirmHandlerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @org.junit.jupiter.api.io.TempDir
    java.nio.file.Path dir;

    private HitlConfirmHandler handler;

    @BeforeEach
    void setUp() {
        handler = new HitlConfirmHandler(new A2UiService(), new A2UiSurfaceRegistry(),
                new RunMetricsService(dir.resolve("m.log")));
    }

    private List<JsonNode> componentsOf(ServerSentEvent<String> sse) throws Exception {
        JsonNode ops = MAPPER.readTree(sse.data()).path("content").path("a2ui_operations");
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode op : ops) {
            for (JsonNode c : op.path("updateComponents").path("components")) out.add(c);
        }
        return out;
    }

    @Test
    void supportsOnlyRequestUserConfirm() {
        assertTrue(handler.supports("request_user_confirm"));
        assertFalse(handler.supports("render_a2ui"));
    }

    @Test
    void buildsConfirmSurfaceWithTwoActions() throws Exception {
        String args = """
                {"actionId":"del-file-1","title":"删除确认","message":"将删除 sales.csv，不可恢复",
                 "confirmLabel":"确认删除","cancelLabel":"再想想"}""";
        Optional<ServerSentEvent<String>> out =
                handler.execute("run-1", "thread-1", MAPPER.readTree(args));
        assertTrue(out.isPresent());
        JsonNode root = MAPPER.readTree(out.get().data());
        assertEquals("ACTIVITY_SNAPSHOT", root.path("type").asText());
        assertEquals("a2ui-hitl-del-file-1", root.path("messageId").asText());

        List<JsonNode> comps = componentsOf(out.get());
        JsonNode warn = comps.stream().filter(c -> "WarningCard".equals(c.path("component").asText()))
                .findFirst().orElseThrow();
        assertEquals("删除确认", warn.path("title").asText());
        assertEquals("将删除 sales.csv，不可恢复", warn.path("text").asText());

        List<JsonNode> buttons = comps.stream()
                .filter(c -> "ActionButton".equals(c.path("component").asText())).toList();
        assertEquals(2, buttons.size());
        JsonNode confirm = buttons.get(0);
        assertEquals("确认删除", confirm.path("label").asText());
        assertEquals("primary", confirm.path("variant").asText());
        assertEquals("hitl_confirm", confirm.path("action").path("event").path("name").asText());
        assertEquals("del-file-1",
                confirm.path("action").path("event").path("context").path("actionId").asText());
        assertEquals("hitl_cancel", buttons.get(1).path("action").path("event").path("name").asText());
    }

    @Test
    void defaultLabelsAndSurfaceIdFallback() throws Exception {
        Optional<ServerSentEvent<String>> out = handler.execute("r", "t",
                MAPPER.readTree("{\"actionId\":\"a1\",\"title\":\"t\",\"message\":\"m\"}"));
        assertTrue(out.isPresent());
        List<JsonNode> comps = componentsOf(out.get());
        JsonNode confirm = comps.stream()
                .filter(c -> "ActionButton".equals(c.path("component").asText())).findFirst().orElseThrow();
        assertEquals("确认", confirm.path("label").asText());
    }

    @Test
    void invalidActionIdRejected() throws Exception {
        assertTrue(handler.execute("r", "t",
                MAPPER.readTree("{\"actionId\":\"../evil\",\"title\":\"t\",\"message\":\"m\"}")).isEmpty());
        assertTrue(handler.execute("r", "t",
                MAPPER.readTree("{\"title\":\"t\",\"message\":\"m\"}")).isEmpty());
    }

    // ---- P14: 并发/顺序边界 ----

    /** 同会话两张确认卡（不同 actionId）：各自独立 surface/messageId 共存。 */
    @Test
    void twoCardsCoexistWithDistinctMessageIds() throws Exception {
        var c1 = handler.execute("r1", "t1", MAPPER.readTree(
                "{\"actionId\":\"act-1\",\"title\":\"删A\",\"message\":\"m1\"}"));
        var c2 = handler.execute("r2", "t1", MAPPER.readTree(
                "{\"actionId\":\"act-2\",\"title\":\"删B\",\"message\":\"m2\"}"));
        assertTrue(c1.isPresent() && c2.isPresent());
        String m1 = MAPPER.readTree(c1.get().data()).path("messageId").asText();
        String m2 = MAPPER.readTree(c2.get().data()).path("messageId").asText();
        assertEquals("a2ui-hitl-act-1", m1);
        assertEquals("a2ui-hitl-act-2", m2);
        assertNotEquals(m1, m2, "两卡 messageId 必须不同（否则互相覆盖）");
    }

    /** 同 actionId 重发（快速连续触发同一确认）：同 messageId 原位替换，不叠卡。 */
    @Test
    void duplicateActionIdReplacesInPlace() throws Exception {
        var c1 = handler.execute("r1", "t1", MAPPER.readTree(
                "{\"actionId\":\"act-1\",\"title\":\"第一次\",\"message\":\"m\"}"));
        var c2 = handler.execute("r2", "t1", MAPPER.readTree(
                "{\"actionId\":\"act-1\",\"title\":\"第二次\",\"message\":\"m\"}"));
        String m1 = MAPPER.readTree(c1.get().data()).path("messageId").asText();
        String m2 = MAPPER.readTree(c2.get().data()).path("messageId").asText();
        assertEquals(m1, m2, "同 actionId 重发 = 原位更新同一卡（replace 语义）");
        // 第二帧内容生效
        assertTrue(componentsOf(c2.get()).stream().anyMatch(c ->
                "第二次".equals(c.path("title").asText())));
    }
}
