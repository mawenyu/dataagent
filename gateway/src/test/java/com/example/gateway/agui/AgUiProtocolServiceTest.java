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
        final List<String> requestOrder = new ArrayList<>();
        final List<String> modelSets = new ArrayList<>();
        final List<String> sessionHistory = new ArrayList<>();

        WebClient client() {
            return WebClient.builder().exchangeFunction(this::exchange).build();
        }

        private Mono<ClientResponse> exchange(ClientRequest req) {
            String path = req.url().getPath();
            String method = req.method().name();
            synchronized (requestOrder) { requestOrder.add(method + " " + path); }
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
            // GET /api/session/{id}/message — 历史消息（脚本化）；先于通用 session GET
            if (path.matches("/api/session/[^/]+/message") && "GET".equals(method)) {
                String body = sessionHistory.isEmpty() ? "{\"data\":[]}" : sessionHistory.remove(0);
                return json(body);
            }
            // GET /api/session/{id} — 存活校验；stub 只认自己创建的 session
            if (path.startsWith("/api/session/") && "GET".equals(method)) {
                String sid = path.substring("/api/session/".length());
                boolean alive = false;
                for (int i = 1; i <= sessionCreates; i++) {
                    if (("ses_stub_" + i).equals(sid)) { alive = true; break; }
                }
                if (alive) return json("{\"data\":{\"id\":\"" + sid + "\"}}");
                return Mono.just(ClientResponse.create(HttpStatus.NOT_FOUND).build());
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
        threadStore = new JsonThreadRepository(storeDir);
        surfaceRegistry = new A2UiSurfaceRegistry();
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        FrontendToolBridge toolBridge = new FrontendToolBridge();
        AguiEventTranslator translator = new AguiEventTranslator(toolBridge, bridge);
        A2UiActionHandler actionHandler = new A2UiActionHandler();
        service = new AgUiProtocolService(stub.client(), translator, toolBridge,
                bridge, actionHandler, new AllowAllThreadAccessPolicy(), threadStore);
    }

    // ------------------------------------------------------------ helpers ---

    private static String ocEvent(String type, String dataJson) {
        return "data: {\"type\":\"" + type + "\",\"data\":" + dataJson + "}\n\n";
    }

    private static String textStep(String msgId, String text) {
        return ocEvent("session.text.started", "{\"assistantMessageID\":\"" + msgId + "\"}")
                + ocEvent("session.text.delta", "{\"assistantMessageID\":\"" + msgId + "\",\"delta\":" + jsonStr(text) + "}")
                + ocEvent("session.text.ended", "{\"assistantMessageID\":\"" + msgId + "\"}")
                + ocEvent("session.step.ended", "{}");
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
    void 需求2_销售概览触发词也走真实LLM() {
        // 原来的 Java 硬编码 surface 分支已删除 —— 任何用户消息都走 OpenCode
        stub.eventStreams.add(textStep("m1", "好的，来看销售概览"));
        List<JsonNode> events = run(userMsg("t-fixed", "给我看销售概览"));
        List<String> types = types(events);
        assertEquals(1, stub.sessionCreates, "必须走真实 OpenCode，不再有硬编码 surface 分支");
        assertTrue(stub.prompts.get(0).contains("销售概览"));
        assertFalse(types.contains("ACTIVITY_SNAPSHOT"), "无 render_a2ui 调用时不应有 surface");
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
    }

    @Test
    void dynamicRenderA2uiNativeToolCallProducesSnapshot() {
        String stream =
                ocEvent("session.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"分析如下\"}")
                + ocEvent("session.text.ended", "{\"assistantMessageID\":\"m1\"}")
                // 真实新方言: 工具名由 tool.input.started 注册, tool.called 只带 id+input
                + ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}")
                + ocEvent("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{"
                                + "\"surfaceId\":\"sales-card\",\"components\":["
                                + "{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"本月销售额\",\"value\":\"1,234,567\"}]}}")
                + ocEvent("session.step.ended", "{}");
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

    /** 2026-08-15：server tool 已在 opencode 注册，原生调用不再截断 run ——
        surface 立即产出，run 自然结束，不 abort（收尾叙述照常流出）。 */
    @Test
    void nativeServerToolRendersWithoutAbort() {
        String stream =
                ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}")
                + ocEvent("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{\"surfaceId\":\"s\",\"components\":[{\"component\":\"Text\",\"id\":\"root\",\"text\":\"hi\"}]}}");
        stub.eventStreams.add(stream);
        List<JsonNode> events = run(userMsg("t-abort", "render"));
        List<String> types = types(events);
        assertTrue(types.contains("ACTIVITY_SNAPSHOT"));
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        assertEquals(0, stub.aborts.size(), "no truncation → no abort");
    }

    @Test
    void 需求2_a2uiAction一律走真实agent续跑() {
        // 原来的 deterministic 路由（refresh_sales → Java 固定 surface）已删除；
        // action 被翻译成 A2UI_ACTION prompt 交给 agent 判断
        stub.eventStreams.add(textStep("m1", "看板已更新"));
        RunAgentInput actionRun = new RunAgentInput("t-act", "run-act", null,
                List.of(Map.of("role", "user", "content", "x")), null, null,
                Map.of("a2uiAction", Map.of("version", "v0.9", "action", Map.of(
                        "name", "refresh_sales", "surfaceId", "sales-overview",
                        "sourceComponentId", "refreshBtn", "timestamp", "t", "context", Map.of()))));
        List<JsonNode> events = run(actionRun);
        assertEquals(1, stub.sessionCreates, "action 必须走真实 OpenCode agent 续跑");
        assertTrue(stub.prompts.get(0).contains("A2UI_ACTION"), "action 翻译为 agent prompt");
        assertTrue(stub.prompts.get(0).contains("refresh_sales"));
        // task6: action 续跑也带会话级数据工作目录提示（threads/<threadId>）
        assertTrue(stub.prompts.get(0).contains("数据工作目录: workspace/" + WorkspaceFileService.THREADS_DIR + "/t-act"),
                "action prompt 包含会话隔离的数据工作目录");
        assertEquals("RUN_FINISHED", types(events).get(types(events).size() - 1));
    }

    @Test
    void surfaceUpdatesKeepStableMessageIdAcrossRuns() throws Exception {
        // 真实路径：agent 两次 render_a2ui 同一 surfaceId → registry 保证 messageId 稳定（原地更新）
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        var args = MAPPER.valueToTree(Map.of("surfaceId", "sales-card",
                "components", List.of(Map.of("component", "MetricCard", "id", "root", "title", "t", "value", "v"))));
        var snap1 = bridge.execute("anonymous", "run-1", "t-upd", args).orElseThrow();
        var snap2 = bridge.execute("anonymous", "run-2", "t-upd", args).orElseThrow();
        String mid1 = MAPPER.readTree(snap1.data()).path("messageId").asText();
        String mid2 = MAPPER.readTree(snap2.data()).path("messageId").asText();
        assertEquals(mid1, mid2, "same surfaceId → stable messageId (in-place update)");
    }

    @Test
    void twoUsersHaveIsolatedSurfaces() {
        // same threadId + surfaceId, different users -> separate registry entries
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        var args = MAPPER.valueToTree(Map.of("surfaceId", "sales-card",
                "components", List.of(Map.of("component", "MetricCard", "id", "root", "title", "t", "value", "v"))));
        bridge.execute("anonymous", "run-1", "t-iso", args);
        bridge.execute("alice", "run-1", "t-iso", args);
        assertTrue(surfaceRegistry.find("anonymous", "t-iso", "sales-card").isPresent());
        assertTrue(surfaceRegistry.find("alice", "t-iso", "sales-card").isPresent());
        assertNotEquals(
                surfaceRegistry.find("anonymous", "t-iso", "sales-card").orElseThrow().userId(),
                surfaceRegistry.find("alice", "t-iso", "sales-card").orElseThrow().userId());
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
        stub.eventStreams.add(ocEvent("session.step.failed", "{\"error\":{\"message\":\"boom\"}}"));
        List<JsonNode> events = run(userMsg("t-err", "hi"));
        assertTrue(types(events).contains("RUN_ERROR"));
        JsonNode err = events.stream().filter(e -> "RUN_ERROR".equals(e.path("type").asText())).findFirst().orElseThrow();
        assertEquals("boom", err.path("message").asText());
        assertEquals("UPSTREAM_ERROR", err.path("code").asText(), "上游失败 code=UPSTREAM_ERROR");
    }

    @Test
    void runErrorJsonEscapesBackslashQuoteNewline() throws Exception {
        // P0: 手写 escape 不转义反斜杠且把引号变异为单引号 —— 改 Jackson 序列化后
        // 内容必须逐字符往返(含 \ " 换行)
        String nasty = "path C:\\temp\\ 结尾反斜杠\\ 引号\" 换行\n结束";
        String json = AgUiProtocolService.runErrorJson(nasty);
        JsonNode n = new ObjectMapper().readTree(json);
        assertEquals("RUN_ERROR", n.path("type").asText());
        assertEquals(nasty, n.path("message").asText(), "内容逐字符保留,无变异");
    }

    @Test
    void runErrorJsonCarriesStructuredCode() throws Exception {
        // TARGET_ARCH §2: 默认无法归类 → UPSTREAM_ERROR；显式 code（超时兜底 RUN_TIMEOUT）原样写入
        ObjectMapper m = new ObjectMapper();
        JsonNode def = m.readTree(AgUiProtocolService.runErrorJson("x"));
        assertEquals("UPSTREAM_ERROR", def.path("code").asText(), "无法归类的 RUN_ERROR 默认 UPSTREAM_ERROR");
        JsonNode timeout = m.readTree(AgUiProtocolService.runErrorJson("x", "RUN_TIMEOUT"));
        assertEquals("RUN_TIMEOUT", timeout.path("code").asText());
        assertEquals("x", timeout.path("message").asText(), "message 保持人话不变");
    }

    @Test
    void malformedSseDataIsSkipped() {
        stub.eventStreams.add(
                "data: {not json at all}\n\n"
                        + ocEvent("session.text.started", "{\"assistantMessageID\":\"m1\"}")
                        + "data: {\"type\":\"session.text.delta\",\"data\":{\"assistantMessageID\":\"m1\",\"delta\":\"ok\"}}\n\n"
                        + "data: \n\n"
                        + ocEvent("session.text.ended", "{\"assistantMessageID\":\"m1\"}")
                        + ocEvent("session.step.ended", "{}"));
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
                ocEvent("session.step.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"先看下数据\"}")
                + ocEvent("session.text.ended", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"bash\"}")
                + ocEvent("session.tool.input.delta", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"delta\":\"ls\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"text\":\"ls\"}")
                + ocEvent("session.tool.success", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"structured\":{},\"content\":[{\"type\":\"text\",\"text\":\"sales.csv\"}]}")
                + ocEvent("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"tool-calls\",\"cost\":0,\"tokens\":{\"input\":10,\"output\":20,\"reasoning\":0,\"cache\":{\"read\":100,\"write\":0}}}")
                // step 2: final answer, finish=stop (run ends)
                + ocEvent("session.step.started", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.text.started", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.text.delta", "{\"assistantMessageID\":\"m2\",\"delta\":\"最终答案\"}")
                + ocEvent("session.text.ended", "{\"assistantMessageID\":\"m2\"}")
                + ocEvent("session.step.ended", "{\"assistantMessageID\":\"m2\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":50,\"output\":60,\"reasoning\":0,\"cache\":{\"read\":200,\"write\":0}}}");
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
                new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(),
                new AllowAllThreadAccessPolicy(), java.time.Duration.ofMillis(300));
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
        assertEquals("RUN_TIMEOUT", err.path("code").asText(), "run 超时兜底路径 code=RUN_TIMEOUT");
        assertEquals(1, stub.aborts.size(), "hung OpenCode session must be aborted so it does not linger");
    }

    /** reasoning.* events become a REASONING_* lifecycle so the UI can show thinking. */
    @Test
    void reasoningStreamIsTranslated() {
        String stream =
                ocEvent("session.reasoning.started", "{\"assistantMessageID\":\"m1\",\"ordinal\":0}")
                + ocEvent("session.reasoning.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"用户在问销售\"}")
                + ocEvent("session.reasoning.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"，先查数据\"}")
                + ocEvent("session.reasoning.ended", "{\"assistantMessageID\":\"m1\",\"text\":\"用户在问销售，先查数据\"}")
                + ocEvent("session.text.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.text.delta", "{\"assistantMessageID\":\"m1\",\"delta\":\"结论\"}")
                + ocEvent("session.text.ended", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":30,\"cache\":{\"read\":0,\"write\":0}}}");
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
        assertEquals("m1-0#1", start.path("messageId").asText(),
                "归并键 assistantMessageID+ordinal 加出现次序后缀（上游会复用同一 key）");
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
                ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c9\",\"name\":\"bash\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c9\",\"text\":\"rm -rf /\"}")
                + ocEvent("session.tool.failed", "{\"assistantMessageID\":\"m1\",\"id\":\"c9\",\"error\":{\"message\":\"permission denied\"}}")
                + ocEvent("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}");
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
        // 可移植性修复后默认是相对路径 "workspace"（opencode cwd=项目根），
        // 断言提示指向默认工作目录而不是过时的绝对路径。
        assertTrue(stub.prompts.get(0).contains("数据工作目录: " + AgUiProtocolService.DEFAULT_DATA_WORKSPACE),
                "prompt should point the agent at the data workspace directory");
    }

    /** The model is configurable (e.g. deepseek-reasoner for visible thinking). */
    @Test
    void configuredModelIsSentToOpenCode() {
        AgUiProtocolService custom = new AgUiProtocolService(stub.client(),
                new AguiEventTranslator(new FrontendToolBridge(),
                        new A2UiBridgeService(new A2UiService(), surfaceRegistry)),
                new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(),
                new AllowAllThreadAccessPolicy(),
                java.time.Duration.ofSeconds(10), "/tmp/ws", "deepseek-reasoner", "deepseek",
                new JsonThreadRepository(storeDir),
                new WorkspaceFileService(storeDir.resolve("ws"), 5 * 1024 * 1024),
                new RunMetricsService(storeDir.resolve("m-unused.log")),
                new HitlConfirmHandler(new A2UiService(), new A2UiSurfaceRegistry(),
                        new RunMetricsService(storeDir.resolve("m2.log"))));
        stub.eventStreams.add(textStep("m1", "ok"));
        custom.run(userMsg("t-model", "hi")).collectList().block(java.time.Duration.ofSeconds(10));
        assertEquals(1, stub.modelSets.size());
        assertTrue(stub.modelSets.get(0).contains("deepseek-reasoner"));
    }

    // ---- 需求 1: 多会话持久化、session 失效重建 ----

    @org.junit.jupiter.api.io.TempDir
    java.nio.file.Path storeDir;

    private JsonThreadRepository threadStore;

    @Test
    void runAutoCreatesThreadWithTitleFromFirstMessage() {
        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-auto", "分析本月销售情况，越详细越好"));
        var t = threadStore.getThread("t-auto").orElseThrow();
        assertTrue(t.title().startsWith("分析本月销售情况"), "title from first user message");
        assertNotNull(t.sessionId(), "thread bound to its OpenCode session");
        assertEquals("ses_stub_1", t.sessionId());
    }

    @Test
    void staleSessionIsRecreatedOnRun() {
        threadStore.createThread("t-stale", null);
        threadStore.bindSession("t-stale", "ses_dead"); // stub 不认识它（GET 404）
        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-stale", "hi"));
        assertEquals(1, stub.sessionCreates, "dead session must be recreated");
        assertEquals("ses_stub_1", threadStore.resolveSession("t-stale"), "mapping rebound");
    }

    @Test
    void liveSessionIsReusedAcrossRuns() {
        stub.eventStreams.add(textStep("m1", "one"));
        stub.eventStreams.add(textStep("m2", "two"));
        run(userMsg("t-reuse", "one"));
        run(userMsg("t-reuse", "two"));
        assertEquals(1, stub.sessionCreates, "liveness check must not recreate live sessions");
    }

    @Test
    void surfaceSnapshotPersistedForReplay() {
        String stream =
                ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}")
                + ocEvent("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{"
                                + "\"surfaceId\":\"sales-card\",\"components\":["
                                + "{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"本月销售额\",\"value\":\"1,234\"}]}}")
                + ocEvent("session.step.ended", "{}");
        stub.eventStreams.add(stream);
        run(userMsg("t-surf", "render"));
        assertEquals(1, threadStore.listSurfaces("t-surf").size(),
                "ACTIVITY_SNAPSHOT persisted so history replay can re-render the surface");
        assertEquals("sales-card", threadStore.listSurfaces("t-surf").get(0).surfaceId());
    }

    /** 实测：v2 官方分支 /api/event 不回放（volatile）——必须先订阅事件流再发 prompt，
        否则 prompt 与订阅之间的快事件（如秒回的 tool call）永久丢失。 */
    @Test
    void eventStreamSubscribesBeforePromptSent() {
        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-order", "hi"));
        int eventIdx = -1, promptIdx = -1;
        for (int i = 0; i < stub.requestOrder.size(); i++) {
            String r = stub.requestOrder.get(i);
            if (r.startsWith("GET /api/event") && eventIdx < 0) eventIdx = i;
            if (r.contains("/prompt") && promptIdx < 0) promptIdx = i;
        }
        assertTrue(eventIdx >= 0 && promptIdx >= 0, "both requests happened: " + stub.requestOrder);
        assertTrue(eventIdx < promptIdx, "event subscription must precede prompt: " + stub.requestOrder);
    }

    /** 实测：v2 官方分支 /api/event 是全局流（所有 session 混合），且子 agent
        的 child session 共享流并有自己的 aggregate seq 序列 —— 不过滤会串会话。 */
    @Test
    void foreignSessionEventsAreFilteredOut() {
        String mine = ocEvent("session.text.started", "{\"sessionID\":\"ses_stub_1\",\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.text.delta", "{\"sessionID\":\"ses_stub_1\",\"assistantMessageID\":\"m1\",\"delta\":\"我的\"}")
                + ocEvent("session.text.ended", "{\"sessionID\":\"ses_stub_1\",\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.step.ended", "{\"sessionID\":\"ses_stub_1\"}");
        String foreign = ocEvent("session.text.started", "{\"sessionID\":\"ses_other\",\"assistantMessageID\":\"x9\"}")
                + ocEvent("session.text.delta", "{\"sessionID\":\"ses_other\",\"assistantMessageID\":\"x9\",\"delta\":\"别人的\"}")
                + ocEvent("session.text.ended", "{\"sessionID\":\"ses_other\",\"assistantMessageID\":\"x9\"}");
        // 交错：外部会话事件插在中间
        String stream = foreign + mine;
        stub.eventStreams.add(stream);
        List<JsonNode> events = run(userMsg("t-filter", "hi"));
        String all = events.toString();
        assertTrue(all.contains("我的"), "own session text present");
        assertFalse(all.contains("别人的"), "foreign session text must be filtered");
    }

    @Test
    void denyingPolicyYieldsRunError() {
        // auth failure simulation (mock — no real auth in this environment, TASK §16)
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        FrontendToolBridge toolBridge = new FrontendToolBridge();
        AguiEventTranslator translator = new AguiEventTranslator(toolBridge, bridge);
        AgUiProtocolService denying = new AgUiProtocolService(stub.client(), translator, toolBridge,
                bridge, new A2UiActionHandler(),
                (userId, threadId) -> false);
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

    // ---- task6: workspace 会话隔离 + 附件消息（spec: docs/spec/workspace-isolation.md）----

    /** run prompt 的数据工作目录按会话隔离：workspace/threads/<threadId>。 */
    @Test
    void promptPointsAtThreadIsolatedWorkspace() {
        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-iso-1", "分析数据"));
        assertTrue(stub.prompts.get(0).contains("数据工作目录: workspace/threads/t-iso-1"),
                "prompt 应指向会话隔离目录, got: " + stub.prompts.get(0));

        stub.eventStreams.add(textStep("m1", "ok"));
        run(userMsg("t-iso-2", "分析数据"));
        assertTrue(stub.prompts.get(1).contains("数据工作目录: workspace/threads/t-iso-2"));
        assertNotEquals(stub.prompts.get(0).split("数据工作目录: ")[1].split("\n")[0],
                stub.prompts.get(1).split("数据工作目录: ")[1].split("\n")[0],
                "不同会话工作目录不同");
    }

    /** 多模态用户消息（text + document parts）→ 文本拼接 + 附件名写入 prompt。 */
    @Test
    void multimodalMessageWithAttachmentsInPrompt() {
        stub.eventStreams.add(textStep("m1", "ok"));
        RunAgentInput input = new RunAgentInput("t-attach", "run-" + System.nanoTime(), null,
                List.of(Map.of("role", "user", "content", List.of(
                        Map.of("type", "text", "text", "分析这个文件"),
                        Map.of("type", "document",
                                "source", Map.of("type", "url", "value", "/agui-api/chat/threads/t-attach/files/sales-q3.csv"),
                                "metadata", Map.of("filename", "sales-q3.csv"))
                ))), null, null, null);
        run(input);
        String prompt = stub.prompts.get(0);
        assertTrue(prompt.contains("分析这个文件"), "text part 拼入 prompt");
        assertTrue(prompt.contains("sales-q3.csv"), "附件文件名写入 prompt");
        assertTrue(prompt.contains("attachments"), "attachments 段落存在");
    }

    /** 纯附件消息（无文本）→ 回退引导语，不再报 empty user message。 */
    @Test
    void attachmentOnlyMessageGetsFallbackText() {
        stub.eventStreams.add(textStep("m1", "ok"));
        RunAgentInput input = new RunAgentInput("t-attach-only", "run-" + System.nanoTime(), null,
                List.of(Map.of("role", "user", "content", List.of(
                        Map.of("type", "document",
                                "source", Map.of("type", "url", "value", "/x/data.csv"),
                                "metadata", Map.of("filename", "data.csv"))
                ))), null, null, null);
        List<JsonNode> events = run(input);
        assertFalse(types(events).contains("RUN_ERROR"), "纯附件消息不应 RUN_ERROR");
        assertTrue(stub.prompts.get(0).contains("data.csv"));
    }

    /** 多模态消息的标题取 text part（而不是 List.toString() 垃圾）。 */
    @Test
    void multimodalMessageTitlesFromTextPart() {
        stub.eventStreams.add(textStep("m1", "ok"));
        RunAgentInput input = new RunAgentInput("t-title-mm", "run-" + System.nanoTime(), null,
                List.of(Map.of("role", "user", "content", List.of(
                        Map.of("type", "text", "text", "看看这份销量"),
                        Map.of("type", "document",
                                "source", Map.of("type", "url", "value", "/x/d.csv"),
                                "metadata", Map.of("filename", "d.csv"))
                ))), null, null, null);
        run(input);
        assertEquals("看看这份销量", threadStore.getThread("t-title-mm").orElseThrow().title());
    }

    // ---- vision-P1: MESSAGES_SNAPSHOT + RAW（spec: docs/spec/agui-protocol-matrix.md）----

    /** RUN_FINISHED 之前发 MESSAGES_SNAPSHOT（OpenCode 历史权威对账，修复 delta 丢失）。 */
    @Test
    void messagesSnapshotEmittedBeforeRunFinished() {
        stub.eventStreams.add(textStep("m1", "你好"));
        stub.sessionHistory.add("""
            {"data":[
              {"id":"a1","type":"assistant","content":[{"type":"text","id":"t0","text":"你好"}]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"hi"}]}
            ]}
            """);
        List<JsonNode> events = run(userMsg("t-snap", "hi"));
        List<String> ts = types(events);
        int snap = ts.indexOf("MESSAGES_SNAPSHOT");
        int fin = ts.indexOf("RUN_FINISHED");
        assertTrue(snap > 0, "MESSAGES_SNAPSHOT emitted, got: " + ts);
        assertTrue(fin > snap, "MESSAGES_SNAPSHOT 必须在 RUN_FINISHED 之前");
        JsonNode snapshot = events.get(snap);
        assertEquals("t-snap", snapshot.path("threadId").asText());
        assertTrue(snapshot.path("messages").size() >= 2);
        assertEquals("user", snapshot.path("messages").get(0).path("role").asText());
        assertEquals("hi", snapshot.path("messages").get(0).path("content").asText());
    }

    /** 历史为空（异常/新 session 边界）时跳过 snapshot —— 空数组会清掉客户端消息，宁可不发。 */
    @Test
    void emptyHistorySkipsMessagesSnapshot() {
        stub.eventStreams.add(textStep("m1", "ok"));
        // stub 默认 {"data":[]} → 转换后 0 条 → 不发
        List<JsonNode> events = run(userMsg("t-snap-empty", "hi"));
        assertFalse(types(events).contains("MESSAGES_SNAPSHOT"), "空历史不发 snapshot");
        assertTrue(types(events).contains("RUN_FINISHED"), "run 正常结束");
    }

    /** forwardedProps.debugRaw=true → 每个 OpenCode 原始事件回显为 RAW（debug 通道）。 */
    @Test
    void debugRawEchoesOpenCodeEvents() {
        stub.eventStreams.add(textStep("m1", "ok"));
        RunAgentInput input = new RunAgentInput("t-raw", "run-raw", null,
                List.of(Map.of("role", "user", "content", "hi")), null, null, Map.of("debugRaw", true));
        List<JsonNode> events = run(input);
        List<JsonNode> raws = events.stream()
                .filter(e -> "RAW".equals(e.path("type").asText())).toList();
        assertFalse(raws.isEmpty(), "debugRaw → RAW events present, got: " + types(events));
        assertEquals("opencode", raws.get(0).path("source").asText());
        assertTrue(raws.get(0).path("event").isObject(), "原始事件以对象内嵌");
        assertTrue(types(events).contains("RUN_FINISHED"), "RAW 回显不影响正常事件流");
    }

    /** 默认（无 debugRaw）不产生 RAW。 */
    @Test
    void noRawEventsByDefault() {
        stub.eventStreams.add(textStep("m1", "ok"));
        List<JsonNode> events = run(userMsg("t-noraw", "hi"));
        assertFalse(types(events).contains("RAW"));
    }

    // ---- P8: run 可观测性（结构化指标日志）----

    /** run 完成/工具调用写结构化 JSON 行到 metrics 文件。 */
    @Test
    void runMetricsWrittenToFile() throws Exception {
        java.nio.file.Path metricsFile = storeDir.resolve("run-metrics.log");
        RunMetricsService metrics = new RunMetricsService(metricsFile);
        AgUiProtocolService svc = new AgUiProtocolService(stub.client(),
                new AguiEventTranslator(new FrontendToolBridge(),
                        new A2UiBridgeService(new A2UiService(), surfaceRegistry)),
                new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(),
                new AllowAllThreadAccessPolicy(),
                java.time.Duration.ofSeconds(10), AgUiProtocolService.DEFAULT_DATA_WORKSPACE,
                "deepseek-chat", "deepseek",
                new JsonThreadRepository(storeDir),
                new WorkspaceFileService(storeDir.resolve("ws"), 5 * 1024 * 1024),
                metrics,
                new HitlConfirmHandler(new A2UiService(), new A2UiSurfaceRegistry(), metrics));
        String stream =
                ocEvent("session.step.started", "{\"assistantMessageID\":\"m1\"}")
                + ocEvent("session.tool.input.started", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"bash\"}")
                + ocEvent("session.tool.input.ended", "{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"text\":\"ls\"}")
                + ocEvent("session.step.ended", "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}");
        stub.eventStreams.add(stream);
        svc.run(userMsg("t-metrics", "ls")).collectList().block(java.time.Duration.ofSeconds(10));

        List<String> lines = java.nio.file.Files.readAllLines(metricsFile);
        assertFalse(lines.isEmpty(), "metrics file written");
        JsonNode runLine = null;
        JsonNode toolLine = null;
        for (String l : lines) {
            JsonNode n = MAPPER.readTree(l);
            if ("run_finished".equals(n.path("type").asText())) runLine = n;
            if ("tool_call".equals(n.path("type").asText())) toolLine = n;
        }
        assertNotNull(runLine, "run_finished 行存在");
        assertEquals("t-metrics", runLine.path("threadId").asText());
        assertEquals("completed", runLine.path("outcome").asText());
        assertTrue(runLine.path("durationMs").asLong() >= 0);
        assertNotNull(toolLine, "tool_call 行存在");
        assertEquals("bash", toolLine.path("tool").asText());
        assertEquals(1, metrics.totalRuns());
        assertEquals(1.0, metrics.successRate(), 1e-9);
    }

    /** HITL：interrupt 记录起点，a2uiAction hitl_* 到达时写 hitl_wait。 */
    @Test
    void hitlWaitMetricRecorded() throws Exception {
        java.nio.file.Path metricsFile = storeDir.resolve("run-metrics-hitl.log");
        RunMetricsService metrics = new RunMetricsService(metricsFile);
        metrics.hitlInterrupted("t-hitl-m", "act-9");
        AgUiProtocolService svc = new AgUiProtocolService(stub.client(),
                new AguiEventTranslator(new FrontendToolBridge(),
                        new A2UiBridgeService(new A2UiService(), surfaceRegistry)),
                new FrontendToolBridge(),
                new A2UiBridgeService(new A2UiService(), surfaceRegistry),
                new A2UiActionHandler(),
                new AllowAllThreadAccessPolicy(),
                java.time.Duration.ofSeconds(10), AgUiProtocolService.DEFAULT_DATA_WORKSPACE,
                "deepseek-chat", "deepseek",
                new JsonThreadRepository(storeDir),
                new WorkspaceFileService(storeDir.resolve("ws"), 5 * 1024 * 1024),
                metrics,
                new HitlConfirmHandler(new A2UiService(), new A2UiSurfaceRegistry(), metrics));
        stub.eventStreams.add(textStep("m1", "好的，已确认"));
        RunAgentInput input = new RunAgentInput("t-hitl-m", "run-hitl", null,
                List.of(Map.of("role", "user", "content", "(clicked)")), null, null,
                Map.of("a2uiAction", Map.of("action", Map.of(
                        "name", "hitl_confirm",
                        "surfaceId", "hitl-act-9",
                        "context", Map.of("actionId", "act-9")))));
        svc.run(input).collectList().block(java.time.Duration.ofSeconds(10));

        List<String> lines = java.nio.file.Files.readAllLines(metricsFile);
        JsonNode hitl = null;
        for (String l : lines) {
            JsonNode n = MAPPER.readTree(l);
            if ("hitl_wait".equals(n.path("type").asText())) hitl = n;
        }
        assertNotNull(hitl, "hitl_wait 行存在");
        assertEquals("act-9", hitl.path("actionId").asText());
        assertEquals("confirm", hitl.path("decision").asText());
        assertTrue(hitl.path("waitMs").asLong() >= 0);
    }

    /** P9-①: 客户端停止（SSE 取消/断开）→ gateway 主动 abort OpenCode session，不再白烧 token。 */
    @Test
    void clientCancelAbortsOpenCodeSession() throws Exception {
        stub.hangEventStream = true; // /api/event 永不响应（模拟 run 进行中）
        reactor.core.Disposable sub = service.run(userMsg("t-cancel", "hi")).subscribe();
        // 等 prompt 真正发出（run 已开始）
        long deadline = System.currentTimeMillis() + 5000;
        while (stub.prompts.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertFalse(stub.prompts.isEmpty(), "run started");
        assertTrue(stub.aborts.isEmpty(), "取消前不应 abort");

        sub.dispose(); // 用户点了停止
        deadline = System.currentTimeMillis() + 5000;
        while (stub.aborts.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertFalse(stub.aborts.isEmpty(), "客户端取消必须触发 OpenCode session abort");
    }

    /** P21: hitl_confirm resume → 流首个 ACTIVITY_SNAPSHOT 是结果徽章（原位更新确认卡）。 */
    @Test
    void hitlResumePrependsResultBadge() {
        stub.eventStreams.add(textStep("m1", "已执行"));
        RunAgentInput input = new RunAgentInput("t-badge", "run-badge", null,
                List.of(Map.of("role", "user", "content", "(clicked)")), null, null,
                Map.of("a2uiAction", Map.of("action", Map.of(
                        "name", "hitl_cancel",
                        "surfaceId", "hitl-act-7",
                        "context", Map.of("actionId", "act-7", "reason", "先别删")))));
        List<JsonNode> events = run(input);
        JsonNode badge = events.stream()
                .filter(e -> "ACTIVITY_SNAPSHOT".equals(e.path("type").asText()))
                .findFirst().orElseThrow(() -> new AssertionError("缺结果徽章快照: " + types(events)));
        assertEquals("a2ui-hitl-act-7", badge.path("messageId").asText());
        String content = badge.path("content").toString();
        assertTrue(content.contains("已拒绝"), content);
        assertTrue(content.contains("先别删"), "附言入卡: " + content);
        // agent 续跑照常
        assertTrue(types(events).contains("RUN_FINISHED"));
    }
}
