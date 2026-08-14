package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Translates OpenCode v2 native SSE events into standard AG-UI events.
 *
 * <p>OpenCode emits: session.next.text.started / .delta / .ended,
 * session.next.tool.input.started / .delta / .ended, session.next.tool.called,
 * session.next.step.started / .ended / .failed, etc.
 * AG-UI expects: RUN_STARTED, TEXT_MESSAGE_START/CONTENT/END,
 * TOOL_CALL_START/ARGS/END, RUN_FINISHED / RUN_ERROR, and optionally
 * ACTIVITY_SNAPSHOT for A2UI surfaces.
 *
 * <p>Tool calls use the prompt-level {@code <tool_call>} contract (see
 * {@link FrontendToolBridge}): the model's response either IS one block
 * (frontend/client tool — the run ends after TOOL_CALL_END so the browser
 * executes it) or is text followed by one block at the end (server-side
 * render_a2ui — mirrored as TOOL_CALL_* and executed by
 * {@link A2UiBridgeService} into an ACTIVITY_SNAPSHOT; the run continues).
 * The translator detects the marker both at message start (lookahead) and
 * mid-stream (holdback of a potential partial marker), so plain text streams
 * with only a few characters of delay.
 *
 * <p>OpenCode builtin tool calls (bash, read, ...) are mirrored as
 * TOOL_CALL_* for progress rendering, but never end the run.
 *
 * * <p>The threadId -> sessionId mapping lives in {@link ChatThreadStore}
 * (需求1: persisted, with stale-session rebinding in AgUiProtocolService).
 */
@Service
public class AguiEventTranslator {

    private static final Logger log = LoggerFactory.getLogger(AguiEventTranslator.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String MARKER = FrontendToolBridge.MARKER;
    private static final String END_MARKER = FrontendToolBridge.END_MARKER;

    private final FrontendToolBridge toolBridge;
    private final A2UiBridgeService a2UiBridge;
    private final java.time.Duration reorderTimeout;

    /** 测试用：默认乱序兜底超时。 */
    public AguiEventTranslator(FrontendToolBridge toolBridge, A2UiBridgeService a2UiBridge) {
        this(toolBridge, a2UiBridge, DEFAULT_REORDER_TIMEOUT);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public AguiEventTranslator(FrontendToolBridge toolBridge, A2UiBridgeService a2UiBridge,
                               @org.springframework.beans.factory.annotation.Value("${agui.event-reorder-timeout:PT3S}")
                               java.time.Duration reorderTimeout) {
        this.toolBridge = toolBridge;
        this.a2UiBridge = a2UiBridge;
        this.reorderTimeout = reorderTimeout;
    }

    /** 乱序缓存的兜底超时（agui.event-reorder-timeout 可配，默认 3s）。 */
    static final java.time.Duration DEFAULT_REORDER_TIMEOUT = java.time.Duration.ofSeconds(3);

    /** Per-assistant-message streaming state for the tool-call lookahead. */
    private enum MsgMode { BUFFERING, TEXT, TOOL_CALL }

    private static final class MsgState {
        final String agMsgId = "ag-" + UUID.randomUUID();
        final StringBuilder buf = new StringBuilder();     // BUFFERING/TOOL_CALL accumulation
        final StringBuilder pending = new StringBuilder(); // TEXT-mode holdback
        MsgMode mode = MsgMode.BUFFERING;
        boolean textStarted = false;
    }

    public Flux<ServerSentEvent<String>> translate(String threadId, String runId, Set<String> frontendTools,
                                                   Flux<ServerSentEvent<String>> opencodeEvents) {
        AtomicBoolean sawOutput = new AtomicBoolean(false);
        AtomicBoolean terminalEmitted = new AtomicBoolean(false);
        // 需求7: AG-UI 客户端状态机要求 STEP_FINISHED/RUN_FINISHED 与 STEP_STARTED 严格配对。
        // OpenCode 的 step 会重叠（多个 step.started 先于 step.ended）且存在孤儿 step
        // （started 后无 ended），因此跟踪"活跃集合"：ended 只关自己，终止事件前关掉所有残余。
        Set<String> activeSteps = new java.util.LinkedHashSet<>();
        Set<String> openReasoning = new java.util.LinkedHashSet<>();
        // 实测：DeepSeek 每个 step 的 reasoning 块复用同一 reasoningID（reasoning-0）。
        // AG-UI 消息按 id 归并，重复 id 会互相污染 —— 每次 started 生成唯一 id。
        Map<String, Integer> reasoningSeen = new ConcurrentHashMap<>();
        Map<String, String> reasoningCurrent = new ConcurrentHashMap<>();
        Map<String, MsgState> msgStates = new ConcurrentHashMap<>();
        Map<String, String> toolCallNames = new ConcurrentHashMap<>();
        Set<String> toolCallStarted = ConcurrentHashMap.newKeySet();
        Set<String> toolCallEnded = ConcurrentHashMap.newKeySet();

        ServerSentEvent<String> runStarted = sse(agEvent("RUN_STARTED", runId, threadId));

        Flux<ServerSentEvent<String>> body = restoreOrder(opencodeEvents.map(AguiEventTranslator::normalizeDialect))
                .concatMap(event -> {
                    String json = event.data();
                    if (json == null || json.isBlank()) return Flux.empty();
                    JsonNode node;
                    try {
                        node = MAPPER.readTree(json);
                    } catch (Exception e) {
                        return Flux.empty();
                    }
                    String type = node.path("type").asText("");
                    JsonNode data = node.path("data");

                    switch (type) {
                        case "session.next.text.started": {
                            String aMsgId = data.path("assistantMessageID").asText();
                            msgStates.put(aMsgId, new MsgState());
                            return Flux.empty(); // decide later: text vs tool_call
                        }
                        case "session.next.text.delta": {
                            String aMsgId = data.path("assistantMessageID").asText();
                            MsgState st = msgStates.get(aMsgId);
                            if (st == null) return Flux.empty();
                            String delta = data.path("delta").asText("");
                            return Flux.fromIterable(
                                    processDelta(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st, delta));
                        }
                        case "session.next.text.ended": {
                            String aMsgId = data.path("assistantMessageID").asText();
                            MsgState st = msgStates.remove(aMsgId);
                            if (st == null) return Flux.empty();
                            return Flux.fromIterable(
                                    processTextEnd(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st));
                        }
                        case "session.next.tool.input.started": {
                            // builtin opencode tools — mirror for progress rendering only
                            String callId = data.path("callID").asText();
                            String name = data.path("name").asText();
                            if (callId.isBlank()) return Flux.empty();
                            toolCallNames.put(callId, name);
                            toolCallStarted.add(callId);
                            sawOutput.set(true);
                            ObjectNode payload = base("TOOL_CALL_START", runId, threadId);
                            payload.put("toolCallId", callId);
                            payload.put("toolCallName", name);
                            return Flux.just(sse(payload));
                        }
                        case "session.next.tool.input.delta": {
                            String callId = data.path("callID").asText();
                            if (!toolCallStarted.contains(callId)) return Flux.empty();
                            ObjectNode payload = base("TOOL_CALL_ARGS", runId, threadId);
                            payload.put("toolCallId", callId);
                            payload.put("delta", data.path("delta").asText(""));
                            return Flux.just(sse(payload));
                        }
                        case "session.next.tool.input.ended": {
                            String callId = data.path("callID").asText();
                            if (!toolCallStarted.contains(callId) || !toolCallEnded.add(callId))
                                return Flux.empty();
                            ObjectNode payload = base("TOOL_CALL_END", runId, threadId);
                            payload.put("toolCallId", callId);
                            return Flux.just(sse(payload));
                        }
                        case "session.next.tool.called": {
                            // fallback for models that don't stream tool input
                            String callId = data.path("callID").asText();
                            String name = data.path("tool").asText("");
                            if (callId.isBlank()) return Flux.empty();
                            // 新方言 tool.called 不带工具名字段 —— 回退到 input.started 注册的
                            if (name.isBlank()) name = toolCallNames.getOrDefault(callId, "");
                            toolCallNames.putIfAbsent(callId, name);
                            sawOutput.set(true);
                            List<ServerSentEvent<String>> out = new ArrayList<>();
                            if (toolCallStarted.add(callId)) {
                                ObjectNode start = base("TOOL_CALL_START", runId, threadId);
                                start.put("toolCallId", callId);
                                start.put("toolCallName", name);
                                ObjectNode args = base("TOOL_CALL_ARGS", runId, threadId);
                                args.put("toolCallId", callId);
                                args.put("delta", data.path("input").isMissingNode() ? "{}" : data.path("input").toString());
                                ObjectNode end = base("TOOL_CALL_END", runId, threadId);
                                end.put("toolCallId", callId);
                                toolCallEnded.add(callId);
                                out.add(sse(start));
                                out.add(sse(args));
                                out.add(sse(end));
                            }
                            // A "real" tool call to render_a2ui (the model emits it as a
                            // genuine tool_call even though OpenCode can't execute it):
                            // execute server-side and finish the run with the surface —
                            // OpenCode's own "unknown tool" follow-up is dropped.
                            if (a2UiBridge.isServerTool(name)) {
                                log.info("server tool call (native): {} id={}", name, callId);
                                closeOpenMessages(runId, threadId, msgStates, openReasoning, out);
                                closeAllActiveSteps(runId, threadId, activeSteps, out);
                                a2UiBridge.execute(runId, threadId, data.path("input")).ifPresent(out::add);
                                if (terminalEmitted.compareAndSet(false, true)) {
                                    out.add(sse(base("RUN_FINISHED", runId, threadId)));
                                }
                            }
                            return Flux.fromIterable(out);
                        }
                        case "session.next.step.failed": {
                            if (!terminalEmitted.compareAndSet(false, true)) return Flux.empty();
                            List<ServerSentEvent<String>> out = new ArrayList<>();
                            closeOpenMessages(runId, threadId, msgStates, openReasoning, out);
                            closeAllActiveSteps(runId, threadId, activeSteps, out);
                            ObjectNode payload = base("RUN_ERROR", runId, threadId);
                            String msg = data.path("error").path("message").asText("unknown error");
                            payload.put("message", msg);
                            out.add(sse(payload));
                            return Flux.fromIterable(out);
                        }
                        case "session.next.step.started": {
                            String stepId = data.path("assistantMessageID").asText("");
                            String stepName = stepId.isBlank() ? "opencode-step" : "step-" + stepId;
                            activeSteps.add(stepName);
                            ObjectNode payload = base("STEP_STARTED", runId, threadId);
                            payload.put("stepName", stepName);
                            return Flux.just(sse(payload));
                        }
                        case "session.next.step.ended": {
                            // OpenCode emits one step PER ASSISTANT TURN; finish=tool-calls
                            // means the agent loop continues (more steps coming). Only a
                            // terminal finish (stop/length/error/...) ends the AG-UI run.
                            String finish = data.path("finish").asText("stop");
                            List<ServerSentEvent<String>> out = new ArrayList<>();
                            String endedId = data.path("assistantMessageID").asText("");
                            String endedName = endedId.isBlank() ? "opencode-step" : "step-" + endedId;
                            if (activeSteps.remove(endedName)) {
                                out.add(stepFinished(runId, threadId, endedName));
                            }
                            JsonNode tokens = data.path("tokens");
                            if (tokens.isObject()) {
                                long input = tokens.path("input").asLong(0);
                                long cacheRead = tokens.path("cache").path("read").asLong(0);
                                ObjectNode usage = base("CUSTOM", runId, threadId);
                                usage.put("name", "context_usage");
                                ObjectNode v = usage.putObject("value");
                                v.put("input", input);
                                v.put("output", tokens.path("output").asLong(0));
                                v.put("reasoning", tokens.path("reasoning").asLong(0));
                                v.put("cacheRead", cacheRead);
                                v.put("cacheWrite", tokens.path("cache").path("write").asLong(0));
                                v.put("contextSize", input + cacheRead);
                                v.put("finish", finish);
                                out.add(sse(usage));
                            }
                            if ("tool-calls".equals(finish)) return Flux.fromIterable(out);
                            if (terminalEmitted.compareAndSet(false, true)) {
                                closeOpenMessages(runId, threadId, msgStates, openReasoning, out);
                                closeAllActiveSteps(runId, threadId, activeSteps, out);
                                out.add(sse(base("RUN_FINISHED", runId, threadId)));
                            }
                            return Flux.fromIterable(out);
                        }
                        case "session.next.reasoning.started": {
                            String rId = data.path("reasoningID").asText();
                            if (rId.isBlank()) return Flux.empty();
                            sawOutput.set(true);
                            String unique = rId + "#" + reasoningSeen.merge(rId, 1, Integer::sum);
                            reasoningCurrent.put(rId, unique);
                            openReasoning.add(unique);
                            ObjectNode start = base("REASONING_START", runId, threadId);
                            start.put("messageId", unique);
                            ObjectNode msgStart = base("REASONING_MESSAGE_START", runId, threadId);
                            msgStart.put("messageId", unique);
                            msgStart.put("role", "reasoning");
                            return Flux.just(sse(start), sse(msgStart));
                        }
                        case "session.next.reasoning.delta": {
                            String rId = reasoningCurrent.get(data.path("reasoningID").asText());
                            if (rId == null) return Flux.empty();
                            ObjectNode payload = base("REASONING_MESSAGE_CONTENT", runId, threadId);
                            payload.put("messageId", rId);
                            payload.put("delta", data.path("delta").asText(""));
                            return Flux.just(sse(payload));
                        }
                        case "session.next.reasoning.ended": {
                            String raw = data.path("reasoningID").asText();
                            String rId = reasoningCurrent.remove(raw);
                            if (rId == null) return Flux.empty();
                            openReasoning.remove(rId);
                            ObjectNode msgEnd = base("REASONING_MESSAGE_END", runId, threadId);
                            msgEnd.put("messageId", rId);
                            ObjectNode end = base("REASONING_END", runId, threadId);
                            end.put("messageId", rId);
                            return Flux.just(sse(msgEnd), sse(end));
                        }
                        case "session.next.tool.success": {
                            String callId = data.path("callID").asText();
                            if (callId.isBlank()) return Flux.empty();
                            ObjectNode payload = base("TOOL_CALL_RESULT", runId, threadId);
                            payload.put("toolCallId", callId);
                            payload.put("messageId", "toolres-" + callId);
                            payload.put("content", summarizeToolResult(data));
                            return Flux.just(sse(payload));
                        }
                        case "session.next.tool.failed": {
                            String callId = data.path("callID").asText();
                            if (callId.isBlank()) return Flux.empty();
                            ObjectNode payload = base("TOOL_CALL_RESULT", runId, threadId);
                            payload.put("toolCallId", callId);
                            payload.put("messageId", "toolres-" + callId);
                            String msg = data.path("error").path("message").asText("unknown error");
                            payload.put("content", "工具执行失败: " + msg);
                            return Flux.just(sse(payload));
                        }
                        default:
                            return Flux.empty();
                    }
                })
                // ensure RUN_FINISHED is always emitted even if opencode ends silently
                .concatWith(Flux.defer(() -> {
                    if (!terminalEmitted.compareAndSet(false, true)) return Flux.empty();
                    List<ServerSentEvent<String>> tail = new ArrayList<>();
                    closeOpenMessages(runId, threadId, msgStates, openReasoning, tail);
                    closeAllActiveSteps(runId, threadId, activeSteps, tail);
                    tail.add(sse(base("RUN_FINISHED", runId, threadId)));
                    return Flux.fromIterable(tail);
                }))
                // close the run (and cancel the upstream opencode stream) at the first terminal event
                .takeUntil(e -> {
                    String d = e.data();
                    return d != null && (d.contains("\"RUN_FINISHED\"") || d.contains("\"RUN_ERROR\""));
                });

        return Flux.concat(Flux.just(runStarted), body);
    }

    // ------------------------------------------------------------------
    // fold by id/ordinal（OpenCode 事件乱序修复）
    // ------------------------------------------------------------------

    /**
     * OpenCode 并发 fiber 不加锁，跨来源事件顺序不保证
     * （core/session/runner/llm.ts:322-328 官方注释："every required event order
     * is per-source ... Cross-source order is unconstrained"）。官方消费指引是
     * "fold by id/ordinal rather than global position"
     * （core/session/runner/publish-llm-event.ts:75-81）。
     *
     * <p>ordinal = durable.seq（每会话单调连续整数，非 delta 事件都带）；
     * delta 事件无 seq，锚定其所属 id（assistantMessageID / callID /
     * reasoningID）最近一个有 seq 的事件。</p>
     *
     * <p>规则：
     * <ul>
     *   <li>seq'd 事件进 TreeMap，按"无缺口连续前缀"下发（drain）</li>
     *   <li>delta 锚点已下发 → 立即透传（若该 id 的 end 已缓存未下发，本 delta
     *       仍先于 end 输出 —— end 先于部分 delta 到达的场景）</li>
     *   <li>delta 锚点未下发（含 delta 先于 start）→ 缓存，锚点下发后回放</li>
     *   <li>id 的 end 已下发后又来 delta → 按 seq 它属于已结束生命周期，丢弃</li>
     *   <li>seq 缺口永不补齐 → 超时强制 flush（agui.event-reorder-timeout）</li>
     *   <li>全流无 seq（旧 stub/测试流）→ 完全直通，保持旧行为</li>
     * </ul></p>
     */
    /**
     * OpenCode v2 官方仓库（v2 分支）事件方言归一化：session.text.X /
     * session.tool.X / session.reasoning.X / session.step.X 不再带 ".next" 段；
     * reasoning 事件没有 reasoningID（用 assistantMessageID+ordinal 合成）；
     * run 级终止是 session.execution.succeeded/failed（映射为 step 终止事件）。
     * 打包二进制（旧方言 session.next.*）原样透传 —— 两种方言都可处理。
     */
    static ServerSentEvent<String> normalizeDialect(ServerSentEvent<String> e) {
        String json = e.data();
        if (json == null || !json.contains("\"session.")) return e;
        try {
            JsonNode node = MAPPER.readTree(json);
            String type = node.path("type").asText("");
            if (!type.startsWith("session.") || type.startsWith("session.next.")) return e;
            String mapped = null;
            if (type.startsWith("session.text.") || type.startsWith("session.tool.")
                    || type.startsWith("session.reasoning.") || type.startsWith("session.step.")) {
                mapped = "session.next." + type.substring("session.".length());
            } else if ("session.execution.succeeded".equals(type)) {
                mapped = "session.next.step.ended";
            } else if ("session.execution.failed".equals(type)) {
                mapped = "session.next.step.failed";
            }
            if (mapped == null) return e; // 非核心事件（inbox/renamed 等）不需要翻译
            ObjectNode out = (ObjectNode) node;
            out.put("type", mapped);
            ObjectNode data = (ObjectNode) out.path("data");
            if (type.startsWith("session.reasoning.")) {
                // 新方言 reasoning 无 reasoningID —— 用 assistantMessageID+ordinal 合成
                data.put("reasoningID",
                        data.path("assistantMessageID").asText() + "-" + data.path("ordinal").asText("0"));
            }
            if (type.startsWith("session.tool.")) {
                // 新方言工具调用 id 字段名是 id（旧方言是 callID）
                if (!data.path("id").asText("").isEmpty() && data.path("callID").asText("").isEmpty()) {
                    data.put("callID", data.path("id").asText());
                }
            }
            if ("session.execution.succeeded".equals(type)) {
                data.put("finish", "stop"); // 映射为终止 step
            }
            return ServerSentEvent.<String>builder().data(MAPPER.writeValueAsString(out)).build();
        } catch (Exception ex) {
            return e;
        }
    }

    Flux<ServerSentEvent<String>> restoreOrder(Flux<ServerSentEvent<String>> source) {
        return Flux.create(sink -> {
            EventOrderer orderer = new EventOrderer(sink, reorderTimeout.toMillis());
            reactor.core.Disposable ticker = Flux.interval(java.time.Duration.ofMillis(200))
                    // 任何异常都不能杀死兜底循环（sink 在取消/完成后的写入会抛）
                    .subscribe(t -> orderer.flushIfStaleSafely(), e -> {});
            reactor.core.Disposable sub = source.subscribe(
                    orderer::offer,
                    sink::error,
                    () -> {
                        orderer.flushAll();
                        sink.complete();
                    });
            sink.onDispose(() -> {
                sub.dispose();
                ticker.dispose();
            });
        });
    }

    private static String eventIdOf(String type, JsonNode data) {
        if (type.startsWith("session.next.reasoning.")) return data.path("reasoningID").asText("");
        if (type.startsWith("session.next.tool.")) return data.path("callID").asText("");
        return data.path("assistantMessageID").asText("");
    }

    private static boolean isEndEvent(String type) {
        return "session.next.text.ended".equals(type)
                || "session.next.reasoning.ended".equals(type)
                || "session.next.tool.input.ended".equals(type);
    }

    private static final class EventOrderer {
        private final reactor.core.publisher.FluxSink<ServerSentEvent<String>> sink;
        private final long timeoutMs;
        private final java.util.TreeMap<Long, ServerSentEvent<String>> bySeq = new java.util.TreeMap<>();
        private final Map<String, Long> anchorSeqById = new java.util.HashMap<>();
        private final Map<String, List<ServerSentEvent<String>>> pendingDeltasById = new java.util.LinkedHashMap<>();
        private final Set<String> endDrainedIds = new java.util.HashSet<>();
        private boolean seqInitialized = false;
        private long nextSeq = 0;
        private long lastProgressMs = System.currentTimeMillis();
        private long oldestBufferedMs = 0;

        EventOrderer(reactor.core.publisher.FluxSink<ServerSentEvent<String>> sink, long timeoutMs) {
            this.sink = sink;
            this.timeoutMs = timeoutMs;
        }

        synchronized void offer(ServerSentEvent<String> e) {
            // 兜底（offer 驱动）：最老缓冲事件超过 timeout 即强制 flush，
            // 不依赖定时器线程
            if (oldestBufferedMs > 0 && System.currentTimeMillis() - oldestBufferedMs > timeoutMs) {
                log.warn("event reorder timeout ({}ms, offer-driven): force-flush nextSeq={} bufferedSeq={}",
                        timeoutMs, nextSeq, bySeq.size());
                flushAll();
            }
            String json = e.data();
            if (json == null || json.isBlank()) {
                emit(e);
                return;
            }
            JsonNode node;
            try {
                node = MAPPER.readTree(json);
            } catch (Exception ex) {
                emit(e);
                return;
            }
            String type = node.path("type").asText("");
            JsonNode data = node.path("data");
            long seq = node.path("durable").path("seq").asLong(-1);
            String id = eventIdOf(type, data);

            if (type.endsWith(".delta")) {
                if (!seqInitialized || id.isEmpty()) {
                    emit(e); // 全流无 seq（旧行为直通）/ 无归属 id
                    return;
                }
                if (endDrainedIds.contains(id)) {
                    // 场景c：end 已下发后的迟到 delta —— 丢弃，不发孤立 CONTENT
                    log.debug("drop late delta for id {} (end already emitted)", id);
                    return;
                }
                Long anchor = anchorSeqById.get(id);
                if (anchor == null || anchor >= nextSeq) {
                    // 场景b：锚点未下发（delta 先于 start 或锚点还在等缺口）→ 缓存待回放
                    pendingDeltasById.computeIfAbsent(id, k -> new ArrayList<>()).add(e);
                } else {
                    // 锚点已下发。即使该 id 的 end 已缓存在 bySeq（end 先于部分 delta
                    // 到达，场景a），本 delta 现在下发也必然排在 end 之前。
                    emit(e);
                }
                return;
            }

            if (seq < 0) {
                emit(e); // 无 seq 的非 delta 事件：无法定序，尽力直通
                return;
            }
            if (!seqInitialized) {
                seqInitialized = true;
                nextSeq = seq; // 中途订阅：以首个 seq 为基线，之前的无关
            }
            if (seq < nextSeq) {
                emit(e); // 缺口已越过才迟到的 seq —— 尽力直通
                return;
            }
            // 锚点在"下发"时更新（emitHeld），不能在到达时更新 —— 否则缓存未下发
            // 的 end 会抢先成为锚点，导致后续 delta 排到 end 之后（实测复现）。
            bySeq.put(seq, e);
            drain();
        }

        private void drain() {
            while (!bySeq.isEmpty() && bySeq.firstKey() == nextSeq) {
                emitHeld(bySeq.pollFirstEntry().getValue(), nextSeq);
                nextSeq++;
            }
            if (bySeq.isEmpty()) oldestBufferedMs = 0;
        }

        private void emitHeld(ServerSentEvent<String> e, long seq) {
            emit(e);
            String type = typeOf(e);
            String id = idOf(e);
            if (!id.isEmpty()) {
                anchorSeqById.put(id, seq);
                List<ServerSentEvent<String>> pending = pendingDeltasById.remove(id);
                if (pending != null) pending.forEach(this::emit); // 锚点下发 → 回放缓存的 delta
                if (isEndEvent(type)) endDrainedIds.add(id);
            }
        }

        synchronized void flushIfStaleSafely() {
            try {
                if (bySeq.isEmpty() && pendingDeltasById.isEmpty()) return;
                if (System.currentTimeMillis() - lastProgressMs < timeoutMs) return;
                log.warn("event reorder timeout ({}ms): force-flush nextSeq={} bufferedSeq={} pendingDeltaIds={}",
                        timeoutMs, nextSeq, bySeq.size(), pendingDeltasById.size());
                flushAll();
            } catch (Exception ex) {
                log.warn("orderer flush failed (stream likely disposed): {}", ex.getMessage());
            }
        }

        synchronized void flushAll() {
            while (!bySeq.isEmpty()) {
                var entry = bySeq.pollFirstEntry();
                emitHeld(entry.getValue(), entry.getKey());
                nextSeq = entry.getKey() + 1;
            }
            pendingDeltasById.values().forEach(list -> list.forEach(this::emit));
            pendingDeltasById.clear();
        }

        private void emit(ServerSentEvent<String> e) {
            lastProgressMs = System.currentTimeMillis();
            sink.next(e);
        }

        private static String typeOf(ServerSentEvent<String> e) {
            try {
                return MAPPER.readTree(e.data()).path("type").asText("");
            } catch (Exception ex) {
                return "";
            }
        }

        private static String idOf(ServerSentEvent<String> e) {
            try {
                JsonNode n = MAPPER.readTree(e.data());
                return eventIdOf(n.path("type").asText(""), n.path("data"));
            } catch (Exception ex) {
                return "";
            }
        }
    }

    // ------------------------------------------------------------------
    // text streaming with tool-call marker detection
    // ------------------------------------------------------------------

    private List<ServerSentEvent<String>> processDelta(String threadId, String runId, Set<String> frontendTools,
                                                       AtomicBoolean terminalEmitted, AtomicBoolean sawOutput,
                                                       Set<String> activeSteps,
                                                       MsgState st, String delta) {
        List<ServerSentEvent<String>> out = new ArrayList<>();
        switch (st.mode) {
            case BUFFERING -> {
                st.buf.append(delta);
                if (toolBridge.couldBecomeMarker(st.buf.toString())) return out;
                // decided: plain text — flush buffer through the marker scanner
                st.mode = MsgMode.TEXT;
                st.pending.append(st.buf);
                st.buf.setLength(0);
                emitTextStart(runId, threadId, st, sawOutput, out);
                scanText(runId, threadId, st, sawOutput, out);
            }
            case TEXT -> {
                st.pending.append(delta);
                scanText(runId, threadId, st, sawOutput, out);
            }
            case TOOL_CALL -> {
                st.buf.append(delta);
                scanToolCall(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st, out);
            }
        }
        return out;
    }

    /** TEXT mode: emit safe text, switch to TOOL_CALL if the marker appears. */
    private void scanText(String runId, String threadId, MsgState st, AtomicBoolean sawOutput,
                          List<ServerSentEvent<String>> out) {
        String p = st.pending.toString();
        int idx = p.indexOf(MARKER);
        if (idx >= 0) {
            String head = p.substring(0, idx);
            if (!head.isEmpty()) emitTextContent(runId, threadId, st, head, sawOutput, out);
            st.mode = MsgMode.TOOL_CALL;
            st.buf.setLength(0);
            st.buf.append(p.substring(idx + MARKER.length()));
            st.pending.setLength(0);
            return; // tool-call tail scanned on next delta / at text end
        }
        int hold = holdbackLen(p);
        int emitLen = p.length() - hold;
        if (emitLen > 0) {
            emitTextContent(runId, threadId, st, p.substring(0, emitLen), sawOutput, out);
            st.pending.delete(0, emitLen);
        }
    }

    /** TOOL_CALL mode: accumulate until END_MARKER, then dispatch the call. */
    private void scanToolCall(String threadId, String runId, Set<String> frontendTools,
                              AtomicBoolean terminalEmitted, AtomicBoolean sawOutput,
                              Set<String> activeSteps,
                              MsgState st, List<ServerSentEvent<String>> out) {
        String b = st.buf.toString();
        int endIdx = b.indexOf(END_MARKER);
        if (endIdx < 0) return;
        String payload = b.substring(0, endIdx);
        String remainder = b.substring(endIdx + END_MARKER.length());
        dispatchToolCall(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st,
                MARKER + payload + END_MARKER, out);
        // anything after the end marker is treated as text again
        st.mode = MsgMode.TEXT;
        st.buf.setLength(0);
        st.pending.setLength(0);
        st.pending.append(remainder);
        scanText(runId, threadId, st, sawOutput, out);
    }

    private List<ServerSentEvent<String>> processTextEnd(String threadId, String runId, Set<String> frontendTools,
                                                         AtomicBoolean terminalEmitted, AtomicBoolean sawOutput,
                                                         Set<String> activeSteps,
                                                         MsgState st) {
        List<ServerSentEvent<String>> out = new ArrayList<>();
        switch (st.mode) {
            case BUFFERING -> {
                // whole-message contract: either one tool_call block or plain text
                var parsed = toolBridge.parseToolCall(st.buf.toString());
                if (parsed.isPresent()) {
                    dispatchToolCall(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st,
                            st.buf.toString(), out);
                } else if (st.buf.length() > 0) {
                    emitTextStart(runId, threadId, st, sawOutput, out);
                    emitTextContent(runId, threadId, st, st.buf.toString(), sawOutput, out);
                    emitTextEnd(runId, threadId, st, out);
                }
            }
            case TEXT -> {
                if (st.pending.length() > 0) {
                    emitTextContent(runId, threadId, st, st.pending.toString(), sawOutput, out);
                    st.pending.setLength(0);
                }
                emitTextEnd(runId, threadId, st, out);
            }
            case TOOL_CALL -> {
                // truncated block — tolerate a missing end marker
                String b = st.buf.toString();
                String payload = b.contains(END_MARKER)
                        ? b.substring(0, b.indexOf(END_MARKER))
                        : b;
                dispatchToolCall(threadId, runId, frontendTools, terminalEmitted, sawOutput, activeSteps, st,
                        MARKER + payload + END_MARKER, out);
                if (st.textStarted) emitTextEnd(runId, threadId, st, out);
            }
        }
        return out;
    }

    /** Parse and route a tool call: server tool (render_a2ui) or frontend tool. */
    private void dispatchToolCall(String threadId, String runId, Set<String> frontendTools,
                                  AtomicBoolean terminalEmitted, AtomicBoolean sawOutput,
                                  Set<String> activeSteps,
                                  MsgState st, String rawBlock, List<ServerSentEvent<String>> out) {
        var parsed = toolBridge.parseToolCall(rawBlock);
        if (parsed.isEmpty()) {
            log.warn("unparseable tool_call block; emitting as text");
            if (!st.textStarted) emitTextStart(runId, threadId, st, sawOutput, out);
            emitTextContent(runId, threadId, st, rawBlock, sawOutput, out);
            return;
        }
        var call = parsed.get();
        sawOutput.set(true);
        if (!frontendTools.isEmpty() && !frontendTools.contains(call.name())
                && !a2UiBridge.isServerTool(call.name())) {
            log.warn("model called undeclared tool '{}' (declared: {})", call.name(), frontendTools);
        }
        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "");
        ObjectNode start = base("TOOL_CALL_START", runId, threadId);
        start.put("toolCallId", toolCallId);
        start.put("toolCallName", call.name());
        start.put("parentMessageId", st.agMsgId);
        out.add(sse(start));
        ObjectNode args = base("TOOL_CALL_ARGS", runId, threadId);
        args.put("toolCallId", toolCallId);
        try {
            args.put("delta", MAPPER.writeValueAsString(call.arguments()));
        } catch (Exception e) {
            args.put("delta", "{}");
        }
        out.add(sse(args));
        ObjectNode end = base("TOOL_CALL_END", runId, threadId);
        end.put("toolCallId", toolCallId);
        out.add(sse(end));

        if (a2UiBridge.isServerTool(call.name())) {
            // server-side tool: execute now, run continues
            log.info("server tool call: {} id={}", call.name(), toolCallId);
            a2UiBridge.execute(runId, threadId, call.arguments()).ifPresent(out::add);
            return;
        }
        // frontend tool: end the run so the browser executes it
        log.info("frontend tool call: {} id={}", call.name(), toolCallId);
        if (terminalEmitted.compareAndSet(false, true)) {
            closeAllActiveSteps(runId, threadId, activeSteps, out);
            out.add(sse(base("RUN_FINISHED", runId, threadId)));
        }
    }

    // ------------------------------------------------------------------
    // small emit helpers
    // ------------------------------------------------------------------

    private void emitTextStart(String runId, String threadId, MsgState st, AtomicBoolean sawOutput,
                               List<ServerSentEvent<String>> out) {
        if (st.textStarted) return;
        st.textStarted = true;
        sawOutput.set(true);
        ObjectNode payload = base("TEXT_MESSAGE_START", runId, threadId);
        payload.put("messageId", st.agMsgId);
        payload.put("role", "assistant");
        out.add(sse(payload));
    }

    private void emitTextContent(String runId, String threadId, MsgState st, String delta,
                                 AtomicBoolean sawOutput, List<ServerSentEvent<String>> out) {
        if (delta.isEmpty()) return;
        emitTextStart(runId, threadId, st, sawOutput, out);
        ObjectNode payload = base("TEXT_MESSAGE_CONTENT", runId, threadId);
        payload.put("messageId", st.agMsgId);
        payload.put("delta", delta);
        out.add(sse(payload));
    }

    private void emitTextEnd(String runId, String threadId, MsgState st, List<ServerSentEvent<String>> out) {
        if (!st.textStarted) return;
        ObjectNode payload = base("TEXT_MESSAGE_END", runId, threadId);
        payload.put("messageId", st.agMsgId);
        out.add(sse(payload));
    }

    /** Close every still-open text message and reasoning stream before a terminal event. */
    private void closeOpenMessages(String runId, String threadId, Map<String, MsgState> msgStates,
                                   Set<String> openReasoning, List<ServerSentEvent<String>> out) {
        for (MsgState st : msgStates.values()) {
            if (st.textStarted) {
                ObjectNode end = base("TEXT_MESSAGE_END", runId, threadId);
                end.put("messageId", st.agMsgId);
                out.add(sse(end));
                st.textStarted = false;
            }
        }
        msgStates.clear();
        for (String rId : new ArrayList<>(openReasoning)) {
            ObjectNode msgEnd = base("REASONING_MESSAGE_END", runId, threadId);
            msgEnd.put("messageId", rId);
            ObjectNode end = base("REASONING_END", runId, threadId);
            end.put("messageId", rId);
            out.add(sse(msgEnd));
            out.add(sse(end));
        }
        openReasoning.clear();
    }

    /**
     * 需求7: the AG-UI client state machine rejects RUN_FINISHED/RUN_ERROR while
     * a step is active, and rejects STEP_FINISHED for a step never started.
     * OpenCode steps overlap and can be orphaned, so we track the active set:
     * step.ended closes only itself; terminal events close everything left.
     */
    private ServerSentEvent<String> stepFinished(String runId, String threadId, String stepName) {
        ObjectNode payload = base("STEP_FINISHED", runId, threadId);
        payload.put("stepName", stepName);
        return sse(payload);
    }

    /** Emit STEP_FINISHED for every still-active step (orphans included), in start order. */
    private void closeAllActiveSteps(String runId, String threadId, Set<String> activeSteps,
                                     List<ServerSentEvent<String>> out) {
        for (String name : new ArrayList<>(activeSteps)) {
            out.add(stepFinished(runId, threadId, name));
        }
        activeSteps.clear();
    }

    /**
     * Best-effort one-string summary of an OpenCode tool result: concatenates
     * text parts of {@code content[]}, falls back to {@code structured} JSON,
     * truncated so a huge tool output never floods the SSE stream.
     */
    private String summarizeToolResult(JsonNode data) {
        StringBuilder sb = new StringBuilder();
        for (JsonNode part : data.path("content")) {
            if ("text".equals(part.path("type").asText())) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(part.path("text").asText(""));
            }
        }
        if (sb.length() == 0 && data.path("structured").isObject() && !data.path("structured").isEmpty()) {
            sb.append(data.path("structured").toString());
        }
        if (sb.length() == 0) sb.append("(无输出)");
        String s = sb.toString();
        return s.length() > 2000 ? s.substring(0, 2000) + "…(截断)" : s;
    }

    /** Length of the longest suffix of {@code s} that is a strict prefix of MARKER. */
    private int holdbackLen(String s) {
        int max = Math.min(s.length(), MARKER.length() - 1);
        for (int k = max; k > 0; k--) {
            if (MARKER.startsWith(s.substring(s.length() - k))) return k;
        }
        return 0;
    }

    private ObjectNode base(String type, String runId, String threadId) {
        ObjectNode n = MAPPER.createObjectNode();
        n.put("type", type);
        n.put("runId", runId);
        n.put("threadId", threadId);
        n.put("timestamp", System.currentTimeMillis());
        return n;
    }

    private ObjectNode agEvent(String type, String runId, String threadId) {
        return base(type, runId, threadId);
    }

    private ServerSentEvent<String> sse(ObjectNode payload) {
        try {
            return ServerSentEvent.<String>builder()
                    .data(MAPPER.writeValueAsString(payload))
                    .build();
        } catch (Exception e) {
            log.error("Failed to serialize AG-UI event", e);
            return ServerSentEvent.<String>builder().data("{}").build();
        }
    }
}
