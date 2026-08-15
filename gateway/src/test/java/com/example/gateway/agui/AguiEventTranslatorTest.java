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

    /** 带 durable.seq 的 OpenCode 事件（seq 是官方 fold 契约里的 ordinal）。 */
    private static ServerSentEvent<String> ocSeq(String type, String dataJson, long seq) {
        return ServerSentEvent.<String>builder()
                .data("{\"type\":\"" + type + "\",\"durable\":{\"seq\":" + seq + "},\"data\":" + dataJson + "}").build();
    }

    private List<JsonNode> translateWithTimeout(Flux<ServerSentEvent<String>> events, java.time.Duration reorderTimeout) {
        A2UiService a2UiService = new A2UiService();
        AguiEventTranslator t = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(a2UiService, new A2UiSurfaceRegistry()), reorderTimeout);
        return t.translate("thread", "run", Set.of("showNotification"), events)
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException("bad event: " + d, e);
                    }
                }).collectList().block(java.time.Duration.ofSeconds(10));
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
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part1) + "}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part2) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));

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
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(fenced) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }

    @Test
    void unparseableToolCallBlockFallsBackToText() {
        String broken = "<tool_call>{not valid json}</tool_call>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(broken) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        assertFalse(types.contains("TOOL_CALL_START"));
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertTrue(allText.contains("tool_call"), "broken block surfaces as plain text");
    }

    /** 2026-08-15 实测：DeepSeek 把 tool_call 的结束标签输出成 DSML 伪标签
        （</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke>），不是 </tool_call> ——
        必须剥离尾巴解析出 JSON，否则整段原始 JSON 当文本泄漏到聊天里。 */
    @Test
    void dsmlTailedToolCallBlockIsParsed() {
        String dsml = "<tool_call>{\"name\":\"render_a2ui\",\"arguments\":{\"surfaceId\":\"s1\","
                + "\"components\":[{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"t\",\"value\":\"v\"}]}}"
                + "</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(dsml) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"), "DSML-tailed block must dispatch as tool call");
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"), "render_a2ui executed server-side");
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertFalse(allText.contains("tool_call"), "no raw tool_call markup leaks to chat text");
        assertFalse(allText.contains("DSML"), "no DSML tags leak to chat text");
    }

    /** DSML 尾巴出现在流式中段（先文字后 tool_call）也要正常派发。 */
    @Test
    void dsmlTailAfterMidStreamMarkerIsParsed() {
        String part1 = "看板如下 <tool_call>{\"name\":\"render_a2ui\",\"arguments\":{\"surfaceId\":\"s1\",";
        String part2 = "\"components\":[{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"t\",\"value\":\"v\"}]}}";
        String part3 = "</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part1) + "}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part2) + "}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(part3) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"));
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"));
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertTrue(allText.contains("看板如下"), "leading text preserved");
        assertFalse(allText.contains("DSML"), "no DSML tags leak to chat text");
    }

    @Test
    void multipleTextMessagesInOneRun() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"one\"}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.started", "{\"assistantMessageID\":\"m2\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m2\",\"delta\":\"two\"}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m2\"}"),
                oc("session.step.ended", "{}")));
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
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        // 需求7: 孤立的 step.ended（无配对 step.started）不再产生 STEP_FINISHED
        assertEquals(List.of("RUN_STARTED", "RUN_FINISHED"), types);
    }

    @Test
    void renderA2uiWhitelistingRejectsUnknownComponents() {
        String evil = "<tool_call>{\"name\":\"render_a2ui\",\"arguments\":{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Script\",\"id\":\"root\",\"text\":\"x\"}]}}</tool_call>";
        List<JsonNode> events = translate(Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(evil) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{}")));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"), "tool call still mirrored for progress UI");
        assertFalse(types.contains("ACTIVITY_SNAPSHOT"), "non-whitelisted component must not render");
    }

    /** 需求7: STEP_FINISHED/RUN_FINISHED 必须与 STEP_STARTED 配对，否则 AG-UI 客户端状态机报错。 */
    @Test
    void nativeServerToolCallClosesActiveStepBeforeRunFinished() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"看板如下\"}"),
                // 注意：text.ended 缺席 —— render_a2ui 截断 run 时文本消息仍开着
                // 真实新方言: 工具名由 tool.input.started 注册, tool.called 只带 id+input
                oc("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}"),
                oc("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}"),
                oc("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{"
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
                oc("session.step.ended", "{\"assistantMessageID\":\"ghost\",\"finish\":\"stop\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}")));
        List<String> types = types(events);
        assertFalse(types.contains("STEP_FINISHED"), "orphan step.ended must not emit STEP_FINISHED");
        assertTrue(types.contains("RUN_FINISHED"), "terminal finish still ends the run");
    }

    @Test
    void stepFailureClosesActiveStepBeforeRunError() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.failed", "{\"assistantMessageID\":\"m1\",\"error\":{\"message\":\"boom\"}}")));
        List<String> types = types(events);
        int sf = types.indexOf("STEP_FINISHED");
        int re = types.indexOf("RUN_ERROR");
        assertTrue(sf >= 0 && re > sf, "STEP_FINISHED must precede RUN_ERROR when a step is active");
    }

    /** 真实 OpenCode 流中 step 会重叠/孤儿化（实测证据：一次 run 内多个 started 先于 ended）。 */
    @Test
    void overlappingAndOrphanStepsAreAllClosedBeforeRunFinished() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"a\"}"),
                oc("session.step.started", "{\"assistantMessageID\":\"b\"}"),
                oc("session.step.ended", "{\"assistantMessageID\":\"b\",\"finish\":\"tool-calls\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}"),
                oc("session.step.started", "{\"assistantMessageID\":\"c\"}"),
                // "a" 和 "c" 永远没有 ended —— 孤儿 step
                oc("session.step.ended", "{\"assistantMessageID\":\"ghost\",\"finish\":\"stop\",\"tokens\":{\"input\":1,\"output\":1,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}")));
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


    // ==================================================================
    // 事件乱序（fold by id/ordinal）—— OpenCode 并发 fiber 不加锁，
    // 跨来源顺序不保证（core/session/runner/llm.ts:322 官方注释）
    // ==================================================================

    /** 正常顺序 + seq：行为与无 seq 一致（对照组）。 */
    @Test
    void orderedStreamUnchanged() {
        List<JsonNode> events = translate(Flux.just(
                ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 1),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"hello\"}"),
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 2),
                ocSeq("session.step.ended", "{}", 3)));
        List<String> types = types(events);
        assertTrue(types.indexOf("TEXT_MESSAGE_START") < types.indexOf("TEXT_MESSAGE_CONTENT"));
        assertTrue(types.indexOf("TEXT_MESSAGE_CONTENT") < types.indexOf("TEXT_MESSAGE_END"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }

    /** 跨 id 乱序：text end(seq=4) 先于 tool end(seq=3) 到达 → 按 seq 重排后下发。 */
    @Test
    void crossIdEndsReorderedBySeq() {
        // seq 分配与"同源有序"一致（tool.input.started 2 < ended 3），
        // 但跨来源乱序到达：text.ended(4) 先于 tool.input.ended(3) 到达
        List<JsonNode> events = translate(Flux.just(
                ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 1),
                ocSeq("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"bash\"}", 2),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"正文\"}"),
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 4),   // 先到（seq 更大）
                ocSeq("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"text\":\"ls\"}", 3), // 后到（seq 更小）
                ocSeq("session.step.ended", "{\"finish\":\"stop\"}", 5)));
        List<String> types = types(events);
        int textEnd = types.indexOf("TEXT_MESSAGE_END");
        int toolEnd = types.indexOf("TOOL_CALL_END");
        assertTrue(textEnd >= 0 && toolEnd >= 0, "both ends emitted");
        assertTrue(toolEnd < textEnd, "tool end (seq=3) must precede text end (seq=4) despite arrival order");
    }

    /** end 先于部分 delta 到达：delta 仍应在 END 前输出。 */
    @Test
    void endBeforeSomeDeltasStillOrdered() {
        List<JsonNode> events = translate(Flux.just(
                ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 1),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"前\"}"),
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 3), // seq 2 缺席 → end 缓存
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"后\"}"), // end 已到达未下发
                ocSeq("session.step.ended", "{\"finish\":\"tool-calls\"}", 2),  // 补上缺口 → end 才下发（非终止，run 继续）
                ocSeq("session.step.ended", "{\"finish\":\"stop\"}", 4)));
        List<String> types = types(events);
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertEquals("前后", allText, "deltas in arrival order, all before END");
        assertTrue(types.indexOf("TEXT_MESSAGE_END") > types.lastIndexOf("TEXT_MESSAGE_CONTENT"));
    }

    /** delta 先于 start 到达：缓存，start 下发后回放。 */
    @Test
    void deltaBeforeStartIsReplayed() {
        List<JsonNode> events = translate(Flux.just(
                ocSeq("session.text.started", "{\"assistantMessageID\":\"other\"}", 1), // 建立 seq 基线
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"早到的\"}"), // m1 的 start 还没到
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"other\"}", 2),
                ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 3),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"正文\"}"),
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 4),
                ocSeq("session.step.ended", "{}", 5)));
        List<String> types = types(events);
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertEquals("早到的正文", allText, "early delta replayed after START, before later delta");
        assertTrue(types.indexOf("TEXT_MESSAGE_START") < types.indexOf("TEXT_MESSAGE_CONTENT"));
    }

    /** end 已下发后迟到的 delta：按 seq 它属于已结束生命周期 → 丢弃。 */
    @Test
    void lateDeltaAfterEndIsDropped() {
        List<JsonNode> events = translate(Flux.just(
                ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 1),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"正文\"}"),
                ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 2),
                ocSeq("session.step.ended", "{\"finish\":\"stop\"}", 3),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"幽灵\"}")));
        String allText = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertEquals("正文", allText, "late delta must be dropped, no orphan CONTENT after END");
    }

    /** seq 缺口永不补齐：超时兜底强制 flush（不卡死），记 warn。 */
    @Test
    void permanentGapFlushesAfterTimeout() {
        A2UiService a2UiService = new A2UiService();
        AguiEventTranslator t = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(a2UiService, new A2UiSurfaceRegistry()), java.time.Duration.ofMillis(300));
        // 上游永不 complete（Flux.never）→ 只有超时 flush 能放出 TEXT_MESSAGE_END
        List<JsonNode> events = t.translate("thread", "run", Set.of(), Flux.just(
                        ocSeq("session.text.started", "{\"assistantMessageID\":\"m1\"}", 1),
                        oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"hi\"}"),
                        ocSeq("session.text.ended", "{\"assistantMessageID\":\"m1\"}", 3)) // seq 2 永远不来
                        .concatWith(Flux.never()))
                .takeUntil(e -> e.data() != null && e.data().contains("TEXT_MESSAGE_END"))
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }).collectList().block(java.time.Duration.ofSeconds(10));
        assertNotNull(events);
        assertEquals("TEXT_MESSAGE_END", types(events).get(types(events).size() - 1),
                "timed-out gap must force-flush the buffered end");
    }

    /** 新方言 reasoning 事件没有独立 id，归并键是 assistantMessageID+ordinal；
        同一 key 的块在一个 run 里重复出现（实测 DeepSeek 每个 step 一块、ordinal 复用 0）
        会让 AG-UI 消息列表出现重复 id —— translator 按出现次序去重。 */
    @Test
    void reusedReasoningIdGetsUniqueMessageIds() {
        String one = "{\"type\":\"session.reasoning.started\",\"data\":{\"assistantMessageID\":\"m1\",\"ordinal\":0}}"
                + "\n\n{\"type\":\"session.reasoning.delta\",\"data\":{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"delta\":\"想\"}}"
                + "\n\n{\"type\":\"session.reasoning.ended\",\"data\":{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"text\":\"想\"}}";
        List<JsonNode> events = translate(Flux.just(
                ServerSentEvent.<String>builder().data(one).build(),
                ServerSentEvent.<String>builder().data(one).build(),
                oc("session.step.ended", "{}")));
        List<String> reasoningStartIds = events.stream()
                .filter(e -> "REASONING_MESSAGE_START".equals(e.path("type").asText()))
                .map(e -> e.path("messageId").asText()).toList();
        assertEquals(2, reasoningStartIds.size());
        assertNotEquals(reasoningStartIds.get(0), reasoningStartIds.get(1),
                "reused upstream reasoning key must map to distinct AG-UI messageIds");
    }

    /** v2 新方言直通（无归一化层）：session.text./tool./reasoning./step. 原生事件名，
        reasoning 无 reasoningID（assistantMessageID+ordinal 合成归并键），
        execution.succeeded 为 run 级终止兜底。 */
    @Test
    void newDialectEventsConsumedDirectly() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.reasoning.started", "{\"assistantMessageID\":\"m1\",\"ordinal\":0}"),
                oc("session.reasoning.delta", "{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"delta\":\"想\"}"),
                oc("session.reasoning.ended", "{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"text\":\"想\"}"),
                oc("session.text.started", "{\"assistantMessageID\":\"m1\",\"ordinal\":0}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"delta\":\"答\"}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\",\"ordinal\":0,\"text\":\"答\"}"),
                oc("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"bash\"}"),
                oc("session.tool.input.delta", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"delta\":\"ls\"}"),
                oc("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"text\":\"ls\"}"),
                oc("session.tool.success", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}"),
                oc("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"tool-calls\",\"tokens\":{\"input\":10,\"output\":5,\"reasoning\":3,\"cache\":{\"read\":7,\"write\":0}}}"),
                oc("session.execution.succeeded", "{\"sessionID\":\"s1\"}")));
        List<String> types = types(events);
        assertTrue(types.contains("REASONING_MESSAGE_CONTENT"), "reasoning delta translated");
        assertTrue(types.contains("TEXT_MESSAGE_CONTENT"));
        assertTrue(types.contains("TOOL_CALL_START"));
        assertTrue(types.contains("TOOL_CALL_ARGS"));
        assertTrue(types.contains("TOOL_CALL_END"));
        assertTrue(types.contains("TOOL_CALL_RESULT"));
        assertTrue(types.contains("STEP_STARTED"));
        assertTrue(types.contains("STEP_FINISHED"));
        assertTrue(events.stream().anyMatch(e -> "CUSTOM".equals(e.path("type").asText())
                && "context_usage".equals(e.path("name").asText())), "tokens → context_usage");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1),
                "execution.succeeded terminates the run");
        // reasoning id 由 assistantMessageID+ordinal 合成
        JsonNode rStart = events.stream()
                .filter(e -> "REASONING_MESSAGE_START".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertTrue(rStart.path("messageId").asText().startsWith("m1"), "synthesized reasoning id");
    }

    /**
     * 回归：2026-08-15 实测捕获的 v2 真实事件流（含 durable.seq 缺口）。
     * 最后一步的 session.text.* 在 gateway 输出中整条丢失（只见 STEP_FINISHED +
     * RUN_FINISHED）。本测试用真实流钉住该场景，必须产出 TEXT_MESSAGE_*。
     */
    @Test
    void realCapturedStreamWithSeqGapsStillEmitsFinalText() throws Exception {
        java.io.InputStream in = getClass().getResourceAsStream("/real-stream-text-drop.json");
        assertNotNull(in, "test resource missing");
        JsonNode arr = MAPPER.readTree(in.readAllBytes());
        List<ServerSentEvent<String>> raw = new java.util.ArrayList<>();
        for (JsonNode e : arr) {
            raw.add(ServerSentEvent.<String>builder().data(MAPPER.writeValueAsString(e)).build());
        }
        List<JsonNode> events = translate(Flux.fromIterable(raw));
        List<String> types = types(events);
        assertTrue(types.contains("TEXT_MESSAGE_START"), "final-step text must stream: " + types);
        assertTrue(types.contains("TEXT_MESSAGE_CONTENT"), "final-step text deltas must stream");
        String text = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertTrue(text.contains("137"), "answer text preserved, got: " + text);
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }


    /** AG-UI STATE_SNAPSHOT: RUN_STARTED 之后立刻给客户端完整初始状态。 */
    @Test
    void initialStateEmittedAsSnapshotAfterRunStarted() {
        List<JsonNode> events = translator.translate("thread", "run", Set.of(),
                        Flux.just(oc("session.step.ended", "{}")),
                        java.util.Map.of("model", "deepseek-reasoner", "workspace", "workspace"))
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        List<String> types = types(events);
        assertEquals("RUN_STARTED", types.get(0));
        assertEquals("STATE_SNAPSHOT", types.get(1), "snapshot right after RUN_STARTED");
        JsonNode snap = events.get(1);
        assertEquals("deepseek-reasoner", snap.path("snapshot").path("model").asText());
        assertEquals("workspace", snap.path("snapshot").path("workspace").asText());
    }

    /** AG-UI STATE_DELTA: step 结算出 token 用量时以 JSON Patch 增量更新 contextSize。 */
    @Test
    void contextUsageAlsoEmittedAsStateDelta() {
        List<JsonNode> events = translate(Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"tokens\":{\"input\":100,\"output\":5,\"reasoning\":3,\"cache\":{\"read\":23,\"write\":0}}}")));
        JsonNode delta = events.stream()
                .filter(e -> "STATE_DELTA".equals(e.path("type").asText())).findFirst().orElseThrow();
        JsonNode patch = delta.path("delta").get(0);
        assertEquals("replace", patch.path("op").asText());
        assertEquals("/contextSize", patch.path("path").asText());
        assertEquals(123, patch.path("value").asInt(), "input+cacheRead");
    }


    /** task5-B1: render_report 经 <tool_call> 派发为确定性 ACTIVITY_SNAPSHOT，run 继续。 */
    @Test
    void renderReportToolCallDispatchesToDeterministicRenderer() throws Exception {
        java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("rr");
        java.nio.file.Files.writeString(dir.resolve("sales.csv"),
                "日期,区域,品类,数量,单价,销售额\n2026-08-01,华北,笔记本,2,7000,14000\n");
        ReportRenderer rr = new ReportRenderer(new WorkspaceFileService(dir, 1 << 20),
                new A2UiService(), new A2UiSurfaceRegistry());
        AguiEventTranslator t = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), new A2UiSurfaceRegistry()), List.of(rr));
        String block = "<tool_call>{\"name\":\"render_report\",\"arguments\":{\"title\":\"报告\",\"dataFile\":\"sales.csv\",\"kpis\":[\"totalSales\"],\"charts\":[{\"type\":\"bar\",\"groupBy\":\"region\"}]}}</tool_call>";
        List<JsonNode> events = t.translate("thread", "run", Set.of(), Flux.just(
                        oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                        oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(block) + "}"),
                        oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                        oc("session.step.ended", "{}")))
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"));
        JsonNode tc = events.stream().filter(e -> "TOOL_CALL_START".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("render_report", tc.path("toolCallName").asText());
        JsonNode snap = events.stream().filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText())).findFirst().orElseThrow();
        String snapStr = snap.path("content").toString();
        assertTrue(snapStr.contains("MetricCard"), "KPI card rendered");
        assertTrue(snapStr.contains("14,000"), "real computed value, not model-written");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1), "run continues and finishes normally");
    }


    /** 2026-08-15 实测：工具原生注册后，模型会把 frontend tool 当原生工具调
        （opencode 回 Unknown tool 并反复重试）。translator 必须在 tool.called
        发现名字属于声明的 frontend tools 时，直接转成前端执行流（TOOL_CALL_END
        + RUN_FINISHED，截断 opencode 的 Unknown-tool 重试循环）。 */
    @Test
    void nativeCallToFrontendToolBecomesClientExecution() {
        String args = "{\"file\":\"sales.csv\",\"cells\":[{\"row\":1,\"col\":5,\"value\":\"999999\"}]}";
        List<JsonNode> events = translator.translate("thread", "run", Set.of("applySpreadsheetEdits"), Flux.just(
                        oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                        oc("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"applySpreadsheetEdits\"}"),
                        oc("session.tool.input.delta", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"delta\":" + json(args) + "}"),
                        oc("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}"),
                        oc("session.tool.called", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":" + args.replace("\\", "\\\\") + "}"),
                        // opencode 随后会发 tool.failed(Unknown tool) 并重试 —— 必须已被截断
                        oc("session.tool.failed", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"error\":{\"message\":\"Unknown tool\"}}"),
                        oc("session.text.started", "{\"assistantMessageID\":\"m2\"}")))
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"), "mirrored for the browser");
        assertTrue(types.contains("TOOL_CALL_END"));
        int end = types.lastIndexOf("TOOL_CALL_END");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        assertTrue(types.indexOf("RUN_FINISHED") > end, "run ends right after the tool call");
        assertFalse(types.contains("TOOL_CALL_RESULT"), "Unknown-tool failure must NOT reach the client");
    }


    /** 2026-08-15 实测回归：原生 render_a2ui 截断 run 后 opencode 仍继续执行，
        尾随事件流入同 session 的下一个 run（把旧回答当成新回答输出）。
        截断分支必须回调上层 abort opencode 执行；正常完成不回调。 */
    @Test
    void nativeServerToolRendersSurfaceWithoutTruncatingRun() {
        java.util.concurrent.atomic.AtomicInteger aborts = new java.util.concurrent.atomic.AtomicInteger();
        List<JsonNode> events = translator.translate("thread", "run", Set.of(), Flux.just(
                oc("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}"),
                oc("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}"),
                oc("session.tool.called", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Text\",\"id\":\"root\",\"text\":\"hi\"}]}}")),
                null, (Runnable) aborts::incrementAndGet)
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"), "surface rendered immediately");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1), "run ends at natural stream end");
        assertEquals(0, aborts.get(), "server tools are registered in opencode now — no truncation, no abort");
    }

    @Test
    void promptContractFrontendToolInvokesAbortHook() {
        java.util.concurrent.atomic.AtomicInteger aborts = new java.util.concurrent.atomic.AtomicInteger();
        String block = "<tool_call>{\"name\":\"showNotification\",\"arguments\":{\"title\":\"t\",\"message\":\"m\"}}</tool_call>";
        List<JsonNode> events = translator.translate("thread", "run", Set.of("showNotification"), Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":" + json(block) + "}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}")),
                null, (Runnable) aborts::incrementAndGet)
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        assertEquals("RUN_FINISHED", types(events).get(types(events).size() - 1));
        assertEquals(1, aborts.get(), "frontend-tool truncation must abort the opencode execution");
    }

    @Test
    void naturalCompletionDoesNotInvokeAbortHook() {
        java.util.concurrent.atomic.AtomicInteger aborts = new java.util.concurrent.atomic.AtomicInteger();
        List<JsonNode> events = translator.translate("thread", "run", Set.of(), Flux.just(
                oc("session.text.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"答\"}"),
                oc("session.text.ended", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\"}")),
                null, (Runnable) aborts::incrementAndGet)
                .map(ServerSentEvent::data)
                .map(d -> { try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); } })
                .collectList().block(java.time.Duration.ofSeconds(5));
        assertEquals("RUN_FINISHED", types(events).get(types(events).size() - 1));
        assertEquals(0, aborts.get(), "natural completion: execution already settled, no abort");
    }

    private static String json(String s) {        try {
            return MAPPER.writeValueAsString(s);
        } catch (Exception e) {
            return "\"\"";
        }
    }

    /** vision-P3: 原生 request_user_confirm → HITL 确认卡片 ACTIVITY_SNAPSHOT 并中断 run。 */
    @Test
    void nativeHitlConfirmRendersInterruptSurface() throws Exception {
        A2UiService a2UiService = new A2UiService();
        AguiEventTranslator t = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(a2UiService, new A2UiSurfaceRegistry()),
                List.of(new HitlConfirmHandler(a2UiService, new A2UiSurfaceRegistry(),
                        new RunMetricsService(java.nio.file.Files.createTempDirectory("hitl-m").resolve("m.log")))));
        List<JsonNode> events = t.translate("thread", "run", Set.of(), Flux.just(
                oc("session.step.started", "{\"assistantMessageID\":\"m1\"}"),
                oc("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c9\",\"name\":\"request_user_confirm\"}"),
                oc("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c9\"}"),
                oc("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"c9\",\"input\":{"
                                + "\"actionId\":\"del-1\",\"title\":\"删除确认\",\"message\":\"将删除 sales.csv\"}}")))
                .map(ServerSentEvent::data)
                .map(d -> {
                    try { return MAPPER.readTree(d); } catch (Exception e) { throw new RuntimeException(e); }
                })
                .collectList().block(java.time.Duration.ofSeconds(5));
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"), "HITL surface rendered: " + types);
        assertEquals("RUN_FINISHED", types.get(types.size() - 1), "interrupt: run 立即结束等用户");
        JsonNode snap = events.get(types.indexOf("ACTIVITY_SNAPSHOT"));
        assertEquals("a2ui-hitl-del-1", snap.path("messageId").asText());
    }
}
