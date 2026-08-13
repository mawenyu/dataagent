package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ClientCodecConfigurer;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Queue;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for the AG-UI endpoint service (TASK §17).
 *
 * <p>OpenCode is stubbed at the WebClient ExchangeFunction level — no server,
 * no network. Each test scripts the SSE body returned for /api/event and
 * asserts on the emitted AG-UI event sequence.
 */
class AgUiProtocolServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Mutable OpenCode stub. */
    static class StubOpenCode {
        int sessionCreates = 0;
        final List<String> prompts = new ArrayList<>();
        final Queue<String> eventStreams = new ArrayDeque<>();
        /** When true, /api/event never responds (simulates a hung agent, e.g. question tool). */
        boolean hangEventStream = false;
        final List<String> aborts = new ArrayList<>();
        final List<String> modelSets = new ArrayList<>();

        WebClient client() {
            return WebClient.builder().exchangeFunction(this::exchange).build();
        }

        private Mono<ClientResponse> exchange(ClientRequest req) {
            String path = req.url().getPath();
            String method = req.method().name();
            if ("/api/session".equals(path) && "POST".equals(method)) {
                sessionCreates++;
                return json("{\"data\":{\"id\":\"ses_stub_" + sessionCreates + "\"}}");
            }
            if (path.endsWith("/model")) {
                modelSets.add(captureBody(req));
                return json("{}");
            }
            if (path.endsWith("/prompt")) {
                prompts.add(captureBody(req));
                return json("{}");
            }
            if (path.endsWith("/abort") && "POST".equals(method)) {
                aborts.add(path);
                return json("true");
            }
            if ("/api/event".equals(path)) {
                if (hangEventStream) return Mono.never();
                String body = eventStreams.poll();
                if (body == null) body = "";
                return Mono.just(ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_TYPE, MediaType.TEXT_EVENT_STREAM_VALUE)
                        .body(body).build());
            }
            return Mono.just(ClientResponse.create(HttpStatus.NOT_FOUND).build());
        }

        private Mono<ClientResponse> json(String body) {
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .body(body).build());
        }

        private static String captureBody(ClientRequest req) {
            try {
                org.springframework.mock.http.client.reactive.MockClientHttpRequest mock =
                        new org.springframework.mock.http.client.reactive.MockClientHttpRequest(HttpMethod.POST, URI.create("http://stub"));
                req.body().insert(mock, new org.springframework.web.reactive.function.BodyInserter.Context() {
                    @Override
                    public List<org.springframework.http.codec.HttpMessageWriter<?>> messageWriters() {
                        return ClientCodecConfigurer.create().getWriters();
                    }

                    @Override
                    public java.util.Optional<org.springframework.http.server.reactive.ServerHttpRequest> serverRequest() {
                        return java.util.Optional.empty();
                    }

                    @Override
                    public Map<String, Object> hints() {
                        return Map.of();
                    }
                }).block();
                var buffer = org.springframework.core.io.buffer.DataBufferUtils.join(mock.getBody()).block();
                byte[] bytes = new byte[buffer.readableByteCount()];
                buffer.read(bytes);
                org.springframework.core.io.buffer.DataBufferUtils.release(buffer);
                return new String(bytes);
            } catch (Exception e) {
                return "<capture failed: " + e.getMessage() + ">";
            }
        }
    }

    private StubOpenCode stub;
    private AgUiProtocolService service;
    private A2UiSurfaceRegistry surfaceRegistry;

    @BeforeEach
    void setUp() {
        stub = new StubOpenCode();
        surfaceRegistry = new A2UiSurfaceRegistry();
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        FrontendToolBridge toolBridge = new FrontendToolBridge();
        AguiEventTranslator translator = new AguiEventTranslator(toolBridge, bridge);
        A2UiActionHandler actionHandler = new A2UiActionHandler(a2UiService, surfaceRegistry);
        service = new AgUiProtocolService(stub.client(), translator, toolBridge, a2UiService,
                bridge, actionHandler, surfaceRegistry, new AllowAllThreadAccessPolicy());
    }

    // ------------------------------------------------------------ helpers ---

    private static String ocEvent(String type, String dataJson) {
        return "data: {\"type\":\"" + type + "\",\"data\":" + dataJson + "}\n\n";
    }

    private static String textStep(String msgId, String text) {
        return ocEvent("session.next.text.started", "{\"assistantMessageID\":\"" + msgId + "\"}")
                + ocEvent("session.next.text.delta", "{\"assistantMessageID\":\"" + msgId + "\",\"delta\":" + jsonStr(text) + "}")
                + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"" + msgId + "\"}")
                + ocEvent("session.next.step.ended", "{}");
    }

    private static String jsonStr(String s) {
        try {
            return MAPPER.writeValueAsString(s);
        } catch (Exception e) {
            return "\"\"";
        }
    }

    private List<JsonNode> run( RunAgentInput input) {
        return service.run(input)
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException("malformed AG-UI event: " + d, e);
                    }
                })
                .collectList()
                .block(java.time.Duration.ofSeconds(10));
    }

    private static List<String> types(List<JsonNode> events) {
        return events.stream().map(e -> e.path("type").asText()).toList();
    }

    private static RunAgentInput userMsg(String threadId, String text) {
        return new RunAgentInput(threadId, "run-" + System.nanoTime(), null,
                List.of(Map.of("role", "user", "content", text)), null, null, null);
    }

    // --------------------------------------------------------------- tests ---

    @Test
    void textStreamingLifecycle() {
        stub.eventStreams.add(textStep("m1", "Hello world"));
        List<JsonNode> events = run(userMsg("t1", "hi"));
        List<String> types = types(events);
        assertEquals("RUN_STARTED", types.get(0));
        assertTrue(types.contains("TEXT_MESSAGE_START"));
        assertTrue(types.contains("TEXT_MESSAGE_CONTENT"));
        assertTrue(types.contains("TEXT_MESSAGE_END"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        assertEquals(1, types.stream().filter("RUN_FINISHED"::equals).count(), "exactly one terminal event");
    }

    @Test
    void multiTurnReusesSessionForSameThread() {
        stub.eventStreams.add(textStep("m1", "first"));
        stub.eventStreams.add(textStep("m2", "second"));
        run(userMsg("t-multi", "one"));
        run(userMsg("t-multi", "two"));
        assertEquals(1, stub.sessionCreates, "thread t-multi must reuse its OpenCode session");
        assertEquals(2, stub.prompts.size());
        assertTrue(stub.prompts.get(1).contains("two"));
    }

    @Test
    void distinctThreadsGetDistinctSessions() {
        stub.eventStreams.add(textStep("m1", "a"));
        stub.eventStreams.add(textStep("m2", "b"));
        run(userMsg("thread-a", "hi"));
        run(userMsg("thread-b", "hi"));
        assertEquals(2, stub.sessionCreates);
    }

    @Test
    void frontendToolCallEndsRunWithToolCallEvents() {
        String toolCallBlock = "<tool_call>{\"name\":\"showNotification\",\"arguments\":{\"title\":\"Sales\",\"message\":\"done\"}}</tool_call>";
        stub.eventStreams.add(textStep("m1", toolCallBlock));
        RunAgentInput input = new RunAgentInput("t-tool", "run-1", null,
                List.of(Map.of("role", "user", "content", "notify me")),
                List.of(Map.of("name", "showNotification", "description", "toast",
                        "parameters", Map.of("type", "object"))),
                null, null);
        List<JsonNode> events = run(input);
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"));
        assertTrue(types.contains("TOOL_CALL_ARGS"));
        assertTrue(types.contains("TOOL_CALL_END"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        JsonNode start = events.stream().filter(e -> "TOOL_CALL_START".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("showNotification", start.path("toolCallName").asText());
    }

    @Test
    void toolResultContinuationBuildsSyntheticPrompt() {
        // the continuation run must send the "[client tool result]" prompt to OpenCode
        stub.eventStreams.add(textStep("m9", "notification shown"));
        RunAgentInput input = new RunAgentInput("t-tool", "run-2", null,
                List.of(
                        Map.of("role", "user", "content", "notify me"),
                        Map.of("role", "assistant", "toolCalls", List.of(Map.of(
                                "id", "call_1", "type", "function",
                                "function", Map.of("name", "showNotification", "arguments", "{\"title\":\"Sales\"}")))),
                        Map.of("role", "tool", "toolCallId", "call_1", "content", "displayed")),
                List.of(Map.of("name", "showNotification")), null, null);
        List<JsonNode> events = run(input);
        assertTrue(types(events).contains("TEXT_MESSAGE_CONTENT"));
        assertEquals(1, stub.prompts.size());
        assertTrue(stub.prompts.get(0).contains("client tool result"), "continuation prompt sent to OpenCode");
        assertTrue(stub.prompts.get(0).contains("displayed"));
    }

    @Test
    void fixedA2uiSurfaceTriggerSkipsLlm() {
        List<JsonNode> events = run(userMsg("t-fixed", "给我看销售概览"));
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"));
        assertEquals(0, stub.sessionCreates, "fixed surface must not call OpenCode");
        JsonNode snap = events.stream().filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("a2ui-sales-overview", snap.path("messageId").asText());
        assertEquals("a2ui-surface", snap.path("activityType").asText());
        assertTrue(snap.path("replace").asBoolean());
    }

    @Test
    void dynamicRenderA2uiNativeToolCallProducesSnapshot() {
        String stream =
                ocEvent("session.next.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"分析如下\"}")
                + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"tool\":\"render_a2ui\",\"input\":{"
                                + "\"surfaceId\":\"sales-card\",\"components\":["
                                + "{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"本月销售额\",\"value\":\"1,234,567\"}]}}")
                + ocEvent("session.next.step.ended", "{}");
        stub.eventStreams.add(stream);
        RunAgentInput input = new RunAgentInput("t-dyn", "run-1", null,
                List.of(Map.of("role", "user", "content", "render a card")), null,
                List.of(Map.of("description", "A2UI Component Schema", "value", "{}")), null);
        List<JsonNode> events = run(input);
        List<String> types = types(events);
        assertTrue(types.contains("TOOL_CALL_START"), "render_a2ui mirrored as tool call");
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"), "server tool executed into a surface");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        JsonNode snap = events.stream().filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("a2ui-sales-card", snap.path("messageId").asText());
        assertTrue(snap.toString().contains("MetricCard"));
    }

    @Test
    void buttonClickActionIsDeterministicAndReusesMessageId() {
        // run 1: fixed surface registers the surface for user anonymous
        run(userMsg("t-act", "给我看销售概览"));
        // run 2: simulate the browser's forwardedProps.a2uiAction
        RunAgentInput actionRun = new RunAgentInput("t-act", "run-act", null,
                List.of(Map.of("role", "user", "content", "给我看销售概览")), null, null,
                Map.of("a2uiAction", Map.of("version", "v0.9", "action", Map.of(
                        "name", "refresh_sales", "surfaceId", "sales-overview",
                        "sourceComponentId", "refreshBtn", "timestamp", "t", "context", Map.of()))));
        List<JsonNode> events = run(actionRun);
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"));
        assertEquals(0, stub.sessionCreates, "deterministic action must not call OpenCode");
        JsonNode snap = events.stream().filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("a2ui-sales-overview", snap.path("messageId").asText(), "surface update reuses messageId");
        assertTrue(snap.toString().contains("已刷新"));
    }

    @Test
    void surfaceUpdatesKeepStableMessageIdAcrossRuns() {
        run(userMsg("t-upd", "给我看销售概览"));
        for (int i = 0; i < 2; i++) {
            RunAgentInput actionRun = new RunAgentInput("t-upd", "run-u" + i, null,
                    List.of(Map.of("role", "user", "content", "x")), null, null,
                    Map.of("a2uiAction", Map.of("action", Map.of(
                            "name", "refresh_sales", "surfaceId", "sales-overview",
                            "sourceComponentId", "b", "timestamp", "t", "context", Map.of()))));
            List<JsonNode> events = run(actionRun);
            JsonNode snap = events.stream().filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText())).findFirst().orElseThrow();
            assertEquals("a2ui-sales-overview", snap.path("messageId").asText());
        }
    }

    @Test
    void twoUsersHaveIsolatedSurfaces() {
        // same threadId + surfaceId, different users -> separate registry entries
        run(userMsg("t-iso", "给我看销售概览")); // anonymous
        service.run(userMsg("t-iso", "给我看销售概览"), "alice").collectList().block();
        assertTrue(surfaceRegistry.find("anonymous", "t-iso", A2UiService.SALES_SURFACE_ID).isPresent());
        assertTrue(surfaceRegistry.find("alice", "t-iso", A2UiService.SALES_SURFACE_ID).isPresent());
        assertNotEquals(
                surfaceRegistry.find("anonymous", "t-iso", A2UiService.SALES_SURFACE_ID).orElseThrow().userId(),
                surfaceRegistry.find("alice", "t-iso", A2UiService.SALES_SURFACE_ID).orElseThrow().userId());
    }

    @Test
    void clientDisconnectCancelsCleanly() {
        stub.eventStreams.add(textStep("m1", "stream") + textStep("m2", "more"));
        // take only the first event, then cancel — the flux must terminate without error
        var first = service.run(userMsg("t-disc", "hi")).take(1).collectList().block(java.time.Duration.ofSeconds(10));
        assertNotNull(first);
        assertEquals(1, first.size());
    }

    @Test
    void stepFailureBecomesRunError() {
        stub.eventStreams.add(ocEvent("session.next.step.failed", "{\"error\":{\"message\":\"boom\"}}"));
        List<JsonNode> events = run(userMsg("t-err", "hi"));
        assertTrue(types(events).contains("RUN_ERROR"));
        JsonNode err = events.stream().filter(e -> "RUN_ERROR".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("boom", err.path("message").asText());
    }

    @Test
    void malformedSseDataIsSkipped() {
        stub.eventStreams.add(
                "data: {not json at all}\n\n"
                        + ocEvent("session.next.text.started", "{\"assistantMessageID\":\"m1\"}")
                        + "data: {\"type\":\"session.next.text.delta\",\"data\":{\"assistantMessageID\":\"m1\",\"delta\":\"ok\"}}\n\n"
                        + "data: \n\n"
                        + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}")
                        + ocEvent("session.next.step.ended", "{}"));
        List<JsonNode> events = run(userMsg("t-mal", "hi"));
        List<String> types = types(events);
        assertTrue(types.contains("TEXT_MESSAGE_CONTENT"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }

    @Test
    void validationRejectsBadInput() {
        RunAgentInput badRunId = new RunAgentInput("t-v", "bad id with spaces!", null,
                List.of(Map.of("role", "user", "content", "hi")), null, null, null);
        assertTrue(types(run(badRunId)).contains("RUN_ERROR"));

        RunAgentInput tooMany = new RunAgentInput("t-v", "run-ok", null,
                java.util.Collections.nCopies(201, Map.of("role", "user", "content", "x")),
                null, null, null);
        assertTrue(types(run(tooMany)).contains("RUN_ERROR"));
    }

    @Test
    void multipleSurfacesGetDistinctMessageIds() {
        // two render_a2ui executions in one thread -> two independent surfaces
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        var args1 = MAPPER.valueToTree(Map.of("surfaceId", "sales-card",
                "components", List.of(Map.of("component", "MetricCard", "id", "root", "title", "t", "value", "v"))));
        var args2 = MAPPER.valueToTree(Map.of("surfaceId", "region-card",
                "components", List.of(Map.of("component", "BarChart", "id", "root", "xField", "r", "yField", "s",
                        "data", List.of(Map.of("r", "华东", "s", 1))))));
        var snap1 = bridge.execute("anonymous", "run-1", "t-multi-surface", args1).orElseThrow();
        var snap2 = bridge.execute("anonymous", "run-1", "t-multi-surface", args2).orElseThrow();
        assertTrue(snap1.data().contains("a2ui-sales-card"));
        assertTrue(snap2.data().contains("a2ui-region-card"));
        assertTrue(surfaceRegistry.find("anonymous", "t-multi-surface", "sales-card").isPresent());
        assertTrue(surfaceRegistry.find("anonymous", "t-multi-surface", "region-card").isPresent());
    }

    // ---- 需求 7: multi-step runs, timeout fallback, reasoning, context usage ----

    /** A step.ended with finish=tool-calls must NOT end the run (root-cause regression test). */
    @Test
    void multiStepToolLoopRunsToCompletion() {
        String stream =
                // step 1: text + builtin bash tool, finish=tool-calls (run continues)
                ocEvent("session.next.step.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"先看下数据\"}")
                + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.tool.input.started", "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"name\":\"bash\"}")
                + ocEvent("session.next.tool.input.delta", "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"delta\":\"ls\"}")
                + ocEvent("session.next.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"text\":\"ls\"}")
                + ocEvent("session.next.tool.success", "{\"assistantMessageID\":\"m1\",\"callID\":\"c1\",\"structured\":{},\"content\":[{\"type\":\"text\",\"text\":\"sales.csv\"}]}")
                + ocEvent("session.next.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"tool-calls\",\"cost\":0,\"tokens\":{\"input\":10,\"output\":20,\"reasoning\":0,\"cache\":{\"read\":100,\"write\":0}}}")
                // step 2: final answer, finish=stop (run ends)
                + ocEvent("session.next.step.started", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.next.text.started", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.next.text.delta", "{\"assistantMessageID\":\"m2\",\"delta\":\"最终答案\"}")
                + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.next.step.ended", "{\"assistantMessageID\":\"m2\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":50,\"output\":60,\"reasoning\":0,\"cache\":{\"read\":200,\"write\":0}}}");
        stub.eventStreams.add(stream);
        List<JsonNode> events = run(userMsg("t-steps", "分析本月销售情况"));
        List<String> types = types(events);
        String all = events.toString();
        assertTrue(all.contains("先看下数据"), "step 1 text must be streamed");
        assertTrue(all.contains("最终答案"), "step 2 text must be streamed (was lost before the fix)");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        assertEquals(1, types.stream().filter("RUN_FINISHED"::equals).count(), "exactly one terminal event");
        // step observability
        assertTrue(types.contains("STEP_STARTED"));
        assertEquals(2, types.stream().filter("STEP_FINISHED"::equals).count());
        // tool result surfaced
        JsonNode result = events.stream()
                .filter(e -> "TOOL_CALL_RESULT".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("c1", result.path("toolCallId").asText());
        assertTrue(result.path("content").asText().contains("sales.csv"));
        // context usage custom event — last one reflects the final step
        List<JsonNode> usages = events.stream()
                .filter(e -> "CUSTOM".equals(e.path("type").asText())
                        && "context_usage".equals(e.path("name").asText())).toList();
        assertEquals(2, usages.size(), "one context_usage per step");
        JsonNode last = usages.get(usages.size() - 1).path("value");
        assertEquals(50, last.path("input").asInt());
        assertEquals(200, last.path("cacheRead").asInt());
        assertEquals(250, last.path("contextSize").asInt(), "contextSize = input + cacheRead");
    }

    /** A hung agent (no events ever) must end with RUN_ERROR, not silence. */
    @Test
    void hungRunTimesOutWithRunError() {
        stub.hangEventStream = true;
        AguiEventTranslator translator = new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry));
        AgUiProtocolService shortTimeout = new AgUiProtocolService(stub.client(), translator,
                new FrontendToolBridge(), new A2UiService(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(new A2UiService(), surfaceRegistry),
                surfaceRegistry, new AllowAllThreadAccessPolicy(), java.time.Duration.ofMillis(300));
        List<JsonNode> events = shortTimeout.run(userMsg("t-hang", "hi"))
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }).collectList().block(java.time.Duration.ofSeconds(10));
        assertNotNull(events);
        List<String> types = types(events);
        assertTrue(types.contains("RUN_ERROR"), "hung run must surface RUN_ERROR");
        JsonNode err = events.stream().filter(e -> "RUN_ERROR".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertTrue(err.path("message").asText().contains("超时"), "timeout message should be user-friendly");
        assertEquals(1, stub.aborts.size(), "hung OpenCode session must be aborted so it does not linger");
    }

    /** reasoning.* events become a REASONING_* lifecycle so the UI can show thinking. */
    @Test
    void reasoningStreamIsTranslated() {
        String stream =
                ocEvent("session.next.reasoning.started", "{\"assistantMessageID\":\"m1\",\"reasoningID\":\"r1\"}")
                + ocEvent("session.next.reasoning.delta", "{\"assistantMessageID\":\"m1\",\"reasoningID\":\"r1\",\"delta\":\"用户在问销售\"}")
                + ocEvent("session.next.reasoning.delta", "{\"assistantMessageID\":\"m1\",\"reasoningID\":\"r1\",\"delta\":\"，先查数据\"}")
                + ocEvent("session.next.reasoning.ended", "{\"assistantMessageID\":\"m1\",\"reasoningID\":\"r1\",\"text\":\"用户在问销售，先查数据\"}")
                + ocEvent("session.next.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"结论\"}")
                + ocEvent("session.next.text.ended", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.next.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":30,\"cache\":{\"read\":0,\"write\":0}}}");
        stub.eventStreams.add(stream);
        List<JsonNode> events = run(userMsg("t-reason", "想想"));
        List<String> types = types(events);
        assertTrue(types.contains("REASONING_START"));
        assertTrue(types.contains("REASONING_MESSAGE_START"));
        assertTrue(types.contains("REASONING_MESSAGE_CONTENT"));
        assertTrue(types.contains("REASONING_MESSAGE_END"));
        assertTrue(types.contains("REASONING_END"));
        JsonNode start = events.stream()
                .filter(e -> "REASONING_MESSAGE_START".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("r1", start.path("messageId").asText());
        assertEquals("reasoning", start.path("role").asText());
        String deltas = events.stream()
                .filter(e -> "REASONING_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        assertEquals("用户在问销售，先查数据", deltas);
        // reasoning appears before the answer text
        assertTrue(types.indexOf("REASONING_MESSAGE_CONTENT") < types.indexOf("TEXT_MESSAGE_CONTENT"));
    }

    /** A failed builtin tool surfaces a TOOL_CALL_RESULT with the error, not silence. */
    @Test
    void toolFailureEmitsToolCallResult() {
        String stream =
                ocEvent("session.next.tool.input.started", "{\"assistantMessageID\":\"m1\",\"callID\":\"c9\",\"name\":\"bash\"}")
                + ocEvent("session.next.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"callID\":\"c9\",\"text\":\"rm -rf /\"}")
                + ocEvent("session.next.tool.failed", "{\"assistantMessageID\":\"m1\",\"callID\":\"c9\",\"error\":{\"message\":\"permission denied\"}}")
                + ocEvent("session.next.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}");
        stub.eventStreams.add(stream);
        List<JsonNode> events = run(userMsg("t-toolfail", "clean"));
        JsonNode result = events.stream()
                .filter(e -> "TOOL_CALL_RESULT".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("c9", result.path("toolCallId").asText());
        assertTrue(result.path("content").asText().contains("permission denied"));
    }

    /** The prompt tells the agent where the data workspace lives (需求7 实测铺垫). */
    @Test
    void promptIncludesDataWorkspaceHint() {
        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-ws", "分析本月销售情况"));
        assertTrue(stub.prompts.get(0).contains("/workspace"),
                "prompt should point the agent at the data workspace directory");
    }

    /** The model is configurable (e.g. deepseek-reasoner for visible thinking). */
    @Test
    void configuredModelIsSentToOpenCode() {
        AgUiProtocolService custom = new AgUiProtocolService(stub.client(),
                new AguiEventTranslator(new FrontendToolBridge(),
                        new A2UiBridgeService(new A2UiService(), surfaceRegistry)),
                new FrontendToolBridge(), new A2UiService(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(new A2UiService(), surfaceRegistry),
                surfaceRegistry, new AllowAllThreadAccessPolicy(),
                java.time.Duration.ofSeconds(10), "/tmp/ws", "deepseek-reasoner", "deepseek");
        stub.eventStreams.add(textStep("m1", "ok"));
        custom.run(userMsg("t-model", "hi")).collectList().block(java.time.Duration.ofSeconds(10));
        assertEquals(1, stub.modelSets.size());
        assertTrue(stub.modelSets.get(0).contains("deepseek-reasoner"));
    }

    @Test
    void denyingPolicyYieldsRunError() {
        // auth failure simulation (mock — no real auth in this environment, TASK §16)
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        FrontendToolBridge toolBridge = new FrontendToolBridge();
        AguiEventTranslator translator = new AguiEventTranslator(toolBridge, bridge);
        AgUiProtocolService denying = new AgUiProtocolService(stub.client(), translator, toolBridge,
                a2UiService, bridge, new A2UiActionHandler(a2UiService, surfaceRegistry),
                surfaceRegistry, (userId, threadId) -> false);
        List<JsonNode> events = denying.run(userMsg("t-deny", "hi"), "mallory")
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                }).collectList().block(java.time.Duration.ofSeconds(10));
        assertNotNull(events);
        assertTrue(events.stream().anyMatch(e -> "RUN_ERROR".equals(e.path("type").asText())
                && e.path("message").asText().contains("denied")));
        assertEquals(0, stub.sessionCreates, "denied run must not reach OpenCode");
    }
}
