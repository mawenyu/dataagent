package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the OpenCode -> AG-UI event translator (TASK §17):
 * marker lookahead, mid-stream tool calls, malformed payloads, terminal guards.
 */
class AguiEventTranslatorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AguiEventTranslator translator;

    @BeforeEach
    void setUp() {
        A2UiService a2UiService = new A2UiService();
        translator = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(a2UiService, new A2UiSurfaceRegistry()));
    }

    private static ServerSentEvent<String> oc(String type, String dataJson) {
        return ServerSentEvent.<String>builder()
                .data("{\"type\":\"" + type + "\",\"data\":" + dataJson + "}").build();
    }

    private List<JsonNode> translate(Flux<ServerSentEvent<String>> events) {
        return translator.translate("thread", "run", Set.of("showNotification"), events)
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException("bad event: " + d, e);
                    }
                }).collectList().block(java.time.Duration.ofSeconds(5));
    }

    private static List<String> types(List<JsonNode> events) {
        return events.stream().map(e -> e.path("type").asText()).toList();
    }

    @Test
    void midStreamMarkerAfterTextBecomesToolCallAndTextIsPreserved() {
        // "先文字、末尾一个 <tool_call> 块" in ONE message (server-tool contract shape)
        String part1 = "本月销售良好，详见卡片 <tool";
        String part2 = "_call>{\"name\":\"render_a2ui\",\"arguments\":{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Text\",\"id\":\"root\",\"text\":\"hi\"}]}}</tool_call>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part1) + "}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part2) + "}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.step.ended", "{}")));

        List<String> types = types(events);
        assertTrue(types.contains("TEXT_MESSAGE_CONTENT"), "leading text preserved");
        assertTrue(types.contains("TOOL_CALL_START"), "marker mid-stream detected");
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"), "server tool executed");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertTrue(allText.contains("本月销售良好"), "text before marker intact");
        assertFalse(allText.contains("tool_call"), "marker markup never leaks into text");
    }

    @Test
    void fencedToolCallBlockIsParsed() {
        String fenced = "```json\n<tool_call>{\"name\":\"showNotification\",\"arguments\":{\"title\":\"t\"}}</tool_call>\n```";
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(fenced) + "}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }

    @Test
    void unparseableToolCallBlockFallsBackToText() {
        String broken = "<tool_call>{not valid json}</tool_call>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(broken) + "}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.step.ended", "{}")));
        List<String> types = types(events);
        assertFalse(types.contains("TOOL_CALL_START"));
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertTrue(allText.contains("tool_call"), "broken block surfaces as plain text");
    }

    @Test
    void multipleTextMessagesInOneRun() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"one\"}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.started", "{\"assistantMessageID\":\"m2\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m2\",\"delta\":\"two\"}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m2\"}"),
                oc("session.next.step.ended", "{}")));
        List<String> types = types(events);
        assertEquals(2, types.stream().filter("TEXT_MESSAGE_START"::equals).count());
        assertEquals(2, types.stream().filter("TEXT_MESSAGE_END"::equals).count());
        assertEquals(1, types.stream().filter("RUN_FINISHED"::equals).count());
    }

    @Test
    void nonJsonEventsAreSkippedAndRunStillFinishes() {
        List<JsonNode> events = translate(Flux.just(
                ServerSentEvent.<String>builder().data("garbage").build(),
                ServerSentEvent.<String>builder().data("").build(),
                oc("session.next.step.ended", "{}")));
        List<String> types = types(events);
        // 需求7: 孤立的 step.ended（无配对 step.started）不再产生 STEP_FINISHED
        assertEquals(List.of("RUN_STARTED", "RUN_FINISHED"), types);
    }

    @Test
    void renderA2uiWhitelistingRejectsUnknownComponents() {
        String evil = "<tool_call>{\"name\":\"render_a2ui\",\"arguments\":{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Script\",\"id\":\"root\",\"text\":\"x\"}]}}</tool_call>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(evil) + "}"),
                oc("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"), "tool call still mirrored for progress UI");
        assertFalse(types.contains("ACTIVITY_SNAPSHOT"), "non-whitelisted component must not render");
    }

    /** 需求7: STEP_FINISHED/RUN_FINISHED 必须与 STEP_STARTED 配对，否则 AG-UI 客户端状态机报错。 */
    @Test
    void nativeServerToolCallClosesActiveStepBeforeRunFinished() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"看板如下\"}"),
                // 注意：text.ended 缺席 —— render_a2ui 截断 run 时文本消息仍开着
                oc("session.next.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"tool\":\"render_a2ui\",\"input\":{"
                                + "\"surfaceId\":\"s1\",\"components\":[{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"t\",\"value\":\"v\"}]}}")));
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        // open text message must be closed before RUN_FINISHED
        int textEnd = types.lastIndexOf("TEXT_MESSAGE_END");
        assertTrue(textEnd > types.indexOf("TEXT_MESSAGE_START"), "open text message closed");
        assertTrue(textEnd < types.size() - 1, "TEXT_MESSAGE_END before RUN_FINISHED");
        // the active step must be closed BEFORE RUN_FINISHED
        int stepFinished = types.indexOf("STEP_FINISHED");
        assertTrue(stepFinished > types.indexOf("STEP_STARTED"), "STEP_FINISHED after STEP_STARTED");
        assertTrue(stepFinished < types.size() - 1, "STEP_FINISHED before RUN_FINISHED");
        JsonNode sf = events.get(stepFinished);
        assertEquals("step-m1", sf.path("stepName").asText());
    }

    @Test
    void stepEndedWithoutStepStartedEmitsNoStepFinished() {
        // replay/late-join: an orphan step.ended must not emit STEP_FINISHED
        // (client rejects "STEP_FINISHED for step that was not started")
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.step.ended", "{\"assistantMessageID\":\"ghost\",\"finish\":\"stop\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}")));
        List<String> types = types(events);
        assertFalse(types.contains("STEP_FINISHED"), "orphan step.ended must not emit STEP_FINISHED");
        assertTrue(types.contains("RUN_FINISHED"), "terminal finish still ends the run");
    }

    @Test
    void stepFailureClosesActiveStepBeforeRunError() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.next.step.failed", "{\"assistantMessageID\":\"m1\",\"error\":{\"message\":\"boom\"}}")));
        List<String> types = types(events);
        int sf = types.indexOf("STEP_FINISHED");
        int re = types.indexOf("RUN_ERROR");
        assertTrue(sf >= 0 && re > sf, "STEP_FINISHED must precede RUN_ERROR when a step is active");
    }

    /** 真实 OpenCode 流中 step 会重叠/孤儿化（实测证据：一次 run 内多个 started 先于 ended）。 */
    @Test
    void overlappingAndOrphanStepsAreAllClosedBeforeRunFinished() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.next.step.started", "{\"assistantMessageID\":\"a\"}"),
                oc("session.next.step.started", "{\"assistantMessageID\":\"b\"}"),
                oc("session.next.step.ended", "{\"assistantMessageID\":\"b\",\"finish\":\"tool-calls\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}"),
                oc("session.next.step.started", "{\"assistantMessageID\":\"c\"}"),
                // "a" 和 "c" 永远没有 ended —— 孤儿 step
                oc("session.next.step.ended", "{\"assistantMessageID\":\"ghost\",\"finish\":\"stop\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}")));
        List<String> types = types(events);
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        long started = types.stream().filter("STEP_STARTED"::equals).count();
        long finished = types.stream().filter("STEP_FINISHED"::equals).count();
        assertEquals(started, finished, "every started step must be finished exactly once");
        assertEquals(3, started);
        // orphan "ghost" must NOT produce STEP_FINISHED
        assertEquals(0, events.stream()
                .filter(e -> "STEP_FINISHED".equals(e.path("type").asText()))
                .filter(e -> "step-ghost".equals(e.path("stepName").asText())).count());
        // all STEP_FINISHED before RUN_FINISHED
        assertTrue(types.lastIndexOf("STEP_FINISHED") < types.size() - 1);
    }

    private static String json(String s) {        try {
            return MAPPER.writeValueAsString(s);
        } catch (Exception e) {
            return "\"\"";
        }
    }
}
