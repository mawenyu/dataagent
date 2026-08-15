package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyExtractors;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeoutException;

/**
 * Standard AG-UI endpoint service.
 *
 * <p>Accepts a {@link RunAgentInput}, maps threadId to an OpenCode session
 * internally, forwards the last user message to OpenCode, then translates the
 * OpenCode event stream into standard AG-UI events.
 *
 * <p>If {@code forwardedProps.a2uiAction} is present, this run is an A2UI
 * interaction callback — the gateway answers it directly with an updated
 * ACTIVITY_SNAPSHOT (no LLM round-trip), proving the A2UI -> Java -> UI loop.
 */
@Service
public class AgUiProtocolService {

    private static final Logger log = LoggerFactory.getLogger(AgUiProtocolService.class);

    /** LLM routed through OpenCode; overridable via agui.model.* (e.g. deepseek-reasoner for visible thinking). */
    static final String DEFAULT_MODEL_ID = "deepseek-chat";
    static final String DEFAULT_PROVIDER_ID = "deepseek";

    /**
     * Idle timeout for a run: if no translated AG-UI event is emitted within
     * this window (e.g. the OpenCode question tool waits for input that never
     * comes, or the provider hangs mid-generation), the run is terminated with
     * RUN_ERROR instead of hanging forever. Long runs keep alive as long as
     * events keep flowing. Configurable via {@code agui.run-idle-timeout}.
     */
    static final Duration DEFAULT_RUN_IDLE_TIMEOUT = Duration.ofSeconds(120);

    /** Where the agent should look for user data files (示例/上传数据). Portable default: ./workspace. */
    private static final String DEFAULT_DATA_WORKSPACE_VALUE = "workspace";
    static final String DEFAULT_DATA_WORKSPACE = DEFAULT_DATA_WORKSPACE_VALUE;

    private final WebClient webClient;
    private final AguiEventTranslator translator;
    private final FrontendToolBridge toolBridge;
    private final A2UiBridgeService a2UiBridge;
    private final A2UiActionHandler actionHandler;
    private final ThreadAccessPolicy threadAccessPolicy;
    private final Duration runIdleTimeout;
    private final String dataWorkspace;
    private final String modelId;
    private final String providerId;
    private final ChatThreadStore threadStore;
    private final WorkspaceFileService workspaceFiles;
    private final RunMetricsService metrics;
    /** vision-P1: MESSAGES_SNAPSHOT 转换器（无状态，直接实例化）。 */
    private final ThreadMessagesService messagesService = new ThreadMessagesService();
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    /** Convenience constructor for tests — default everything, throwaway temp store. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, DEFAULT_RUN_IDLE_TIMEOUT, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore(), throwawayWorkspace(), throwawayMetrics());
    }

    /** Convenience constructor for tests — custom idle timeout. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               Duration runIdleTimeout) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, runIdleTimeout, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore(), throwawayWorkspace(), throwawayMetrics());
    }

    /** Convenience constructor for tests — store given (需求1 persistence assertions). */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               ChatThreadStore threadStore) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, DEFAULT_RUN_IDLE_TIMEOUT, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, threadStore, throwawayWorkspace(), throwawayMetrics());
    }

    /** Convenience constructor for tests — custom timeout + workspace, default model. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               Duration runIdleTimeout, String dataWorkspace) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, runIdleTimeout, dataWorkspace,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore(), throwawayWorkspace(), throwawayMetrics());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               @org.springframework.beans.factory.annotation.Value("${agui.run-idle-timeout:PT120S}")
                               Duration runIdleTimeout,
                               @org.springframework.beans.factory.annotation.Value("${agui.data-workspace:" + DEFAULT_DATA_WORKSPACE_VALUE + "}")
                               String dataWorkspace,
                               @org.springframework.beans.factory.annotation.Value("${agui.model.id:" + DEFAULT_MODEL_ID + "}")
                               String modelId,
                               @org.springframework.beans.factory.annotation.Value("${agui.model.provider-id:" + DEFAULT_PROVIDER_ID + "}")
                               String providerId,
                               ChatThreadStore threadStore,
                               WorkspaceFileService workspaceFiles,
                               RunMetricsService metrics) {
        this.webClient = opencodeWebClient;
        this.translator = translator;
        this.toolBridge = toolBridge;
        this.a2UiBridge = a2UiBridge;
        this.actionHandler = actionHandler;
        this.threadAccessPolicy = threadAccessPolicy;
        this.runIdleTimeout = runIdleTimeout;
        this.dataWorkspace = dataWorkspace;
        this.modelId = modelId;
        this.providerId = providerId;
        this.threadStore = threadStore;
        this.workspaceFiles = workspaceFiles;
        this.metrics = metrics;
    }

    private static ChatThreadStore throwawayStore() {
        try {
            return new ChatThreadStore(java.nio.file.Files.createTempDirectory("agui-threads-test"));
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    /** 测试便捷构造用：临时文件 metrics。 */
    private static RunMetricsService throwawayMetrics() {
        try {
            return new RunMetricsService(java.nio.file.Files.createTempDirectory("agui-metrics-test")
                    .resolve("run-metrics.log"));
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    /** 测试便捷构造用：临时目录 workspace（避免污染真实 workspace/）。 */
    private static WorkspaceFileService throwawayWorkspace() {
        try {
            return new WorkspaceFileService(
                    java.nio.file.Files.createTempDirectory("agui-workspace-test"), 5 * 1024 * 1024);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    public Flux<ServerSentEvent<String>> run(RunAgentInput input) {
        return run(input, "anonymous");
    }

    public Flux<ServerSentEvent<String>> run(RunAgentInput input, String userId) {
        String threadId = input.threadId() != null ? input.threadId() : "thread-" + UUID.randomUUID();
        String runId = input.runId() != null ? input.runId() : "run-" + UUID.randomUUID();
        final String uid = (userId == null || userId.isBlank()) ? "anonymous" : userId;

        // Loose input validation (no auth per TASK §16 — validation only; auth entry point TODO)
        String validationError = validate(input, runId);
        if (validationError != null) {
            log.warn("AG-UI request rejected: {}", validationError);
            return Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"" + escape(validationError) + "\"}"));
        }

        // Pluggable thread authorization (currently allow-all, TASK §16)
        if (!threadAccessPolicy.canAccess(uid, threadId)) {
            log.warn("thread access denied: user={} thread={}", uid, threadId);
            return Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"thread access denied\"}"));
        }

        // 需求1: 自动建档（前端可不显式 POST /chat/threads）+ 首条用户消息作标题
        if (threadStore.getThread(threadId).isEmpty()) {
            threadStore.createThread(threadId, null);
        }
        UserContent firstUser = extractLastUserContent(input.messages());
        if (firstUser != null) {
            String title = firstUser.text();
            if ((title == null || title.isBlank()) && !firstUser.attachments().isEmpty()) {
                title = "📎 " + firstUser.attachments().get(0);
            }
            if (title != null) threadStore.setTitleFromFirstMessage(threadId, title);
        }
        threadStore.touch(threadId);

        // task6: 会话级 workspace —— 懒创建 threads/<threadId> 并首次播种共享根示例
        // 数据；prompt 指向会话目录，各会话文件互不串扰（spec: workspace-isolation.md）
        String threadWorkspace = dataWorkspace;
        if (workspaceFiles.forThread(threadId).isPresent()) {
            threadWorkspace = dataWorkspace + "/" + WorkspaceFileService.THREADS_DIR + "/" + threadId;
        }

        // P8: run 可观测性 —— 起点/终点/工具耗时结构化指标
        metrics.runStarted(runId, threadId);
        return doRun(input, uid, threadId, runId, threadWorkspace)
                .doOnNext(e -> {
                    persistSurfaceSnapshot(threadId, e);
                    tapMetrics(runId, threadId, e);
                });
    }

    /** 需求1: 把 ACTIVITY_SNAPSHOT 的 surface 内容落盘，供历史回放重放看板。 */
    private void persistSurfaceSnapshot(String threadId, ServerSentEvent<String> e) {
        String d = e.data();
        if (d == null || !d.contains("ACTIVITY_SNAPSHOT") || !d.contains("a2ui-surface")) return;
        try {
            JsonNode n = new com.fasterxml.jackson.databind.ObjectMapper().readTree(d);
            String surfaceId = null;
            for (JsonNode op : n.path("content").path("a2ui_operations")) {
                JsonNode cs = op.path("createSurface");
                if (cs.isObject()) {
                    surfaceId = cs.path("surfaceId").asText(null);
                    break;
                }
            }
            if (surfaceId == null) {
                String mid = n.path("messageId").asText("");
                if (mid.startsWith("a2ui-")) surfaceId = mid.substring("a2ui-".length());
            }
            if (surfaceId != null && !surfaceId.isBlank()) {
                threadStore.saveSurface(threadId, surfaceId, n.path("content").toString());
            }
        } catch (Exception ex) {
            log.debug("surface persist skipped: {}", ex.getMessage());
        }
    }

    private Flux<ServerSentEvent<String>> doRun(RunAgentInput input, String uid, String threadId, String runId,
                                                String threadWorkspace) {

        // 需求2: A2UI action 回传一律走真实 agent 续跑（无任何 Java 侧 if/else
        // 固定 surface）。action 被翻译成 A2UI_ACTION prompt，由 agent 判断并
        // 用 render_a2ui 更新同名 surface。
        if (input.forwardedProps() != null && input.forwardedProps().containsKey("a2uiAction")) {
            Object rawAction = input.forwardedProps().get("a2uiAction");
            log.info("A2UI action received on thread {} (user={}): {}", threadId, uid, rawAction);
            // P8: HITL 决策到达 → 记录人工确认等待时长
            tapHitlMetric(threadId, rawAction);
            StringBuilder p = new StringBuilder();
            if (a2UiBridge.hasA2uiContext(input.context())) {
                p.append(a2UiBridge.buildServerToolSection(input.context())).append("\n\n");
            }
            // task6 补齐：action 续跑也要带会话级数据工作目录提示（隔离后模型
            // 不知道 CSV 在 threads/<threadId> 下，实测出现不查数据直接回答）
            p.append("<environment>\n数据工作目录: ").append(threadWorkspace)
                    .append("\n用户的数据文件（如销售 CSV）放在该目录；分析数据问题时先在此目录查找，回答用中文。\n</environment>\n\n");
            p.append(actionHandler.buildAgentPrompt(rawAction));
            return runAgent(input, uid, threadId, runId, p.toString());
        }

        // AG-UI frontend-tool contract (see FrontendToolBridge):
        // - last message is a tool result -> continue with a synthetic prompt
        // - otherwise send the user message; input.tools decides which OpenCode
        //   tool calls are browser-executed (see AguiEventTranslator)
        List<Map<String, Object>> tools = toolBridge.sanitizeTools(input.tools());
        String promptText;
        var continuation = toolBridge.buildContinuationPrompt(input.messages());
        if (continuation.isPresent()) {
            promptText = continuation.get();
            log.info("frontend tool result received on thread {}: {}", threadId,
                    promptText.substring(0, Math.min(160, promptText.length())));
        } else {
            UserContent userContent = extractLastUserContent(input.messages());
            // task6: 纯附件消息（ChatGPT 式上传后不带文字直接发送）回退引导语
            String userMessage = userContent == null ? null : userContent.text();
            if ((userMessage == null || userMessage.isBlank())
                    && userContent != null && !userContent.attachments().isEmpty()) {
                userMessage = "请分析我上传的数据文件";
            }
            if (userMessage == null || userMessage.isBlank()) {
                return Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"empty user message\"}"));
            }
            // Prompt assembly: client-tool contract (browser tools) + server-tool
            // contract (render_a2ui, only when the client advertised A2UI via
            // RunAgentInput.context) + the user message. See FrontendToolBridge /
            // A2UiBridgeService.
            StringBuilder p = new StringBuilder();
            String clientSection = toolBridge.buildClientToolsSection(tools);
            if (!clientSection.isEmpty()) p.append(clientSection).append("\n\n");
            if (a2UiBridge.hasA2uiContext(input.context())) {
                p.append(a2UiBridge.buildServerToolSection(input.context())).append("\n\n");
            }
            // 需求7: point the agent at the data workspace so "分析本月销售情况"
            // finds real data instead of wandering the repo (and hitting
            // external_directory permission asks that hang headless).
            // task6: 数据工作目录按会话隔离（workspace/threads/<threadId>）。
            p.append("<environment>\n数据工作目录: ").append(threadWorkspace)
                    .append("\n用户的数据文件（如销售 CSV）放在该目录；分析数据问题时先在此目录查找，回答用中文。\n</environment>\n\n");
            // task6: 附件文件名写入 prompt —— 文件已落盘到会话工作目录，agent 直接读
            if (userContent != null && !userContent.attachments().isEmpty()) {
                p.append("<attachments>\n用户随消息上传了文件: ")
                        .append(String.join(", ", userContent.attachments()))
                        .append("（已保存到数据工作目录，直接用工具读取分析）\n</attachments>\n\n");
            }
            p.append("<user_message>\n").append(userMessage).append("\n</user_message>");
            promptText = p.toString();
        }

        return runAgent(input, uid, threadId, runId, promptText);
    }

    /** Shared agent-run path: resolve session, send prompt, stream translated events. */
    private Flux<ServerSentEvent<String>> runAgent(RunAgentInput input, String userId,
                                                   String threadId, String runId, String promptText) {
        java.util.Set<String> frontendToolNames = toolBridge.sanitizeTools(input.tools()).stream()
                .map(t -> String.valueOf(t.get("name")))
                .collect(java.util.stream.Collectors.toSet());
        final String finalThreadId = threadId;
        final String finalRunId = runId;
        final String finalPrompt = promptText;
        // vision-P1: debug 通道 —— forwardedProps.debugRaw=true 时把 OpenCode
        // 原始事件以 AG-UI RAW 事件回显（spec: agui-protocol-matrix.md）
        final boolean debugRaw = input.forwardedProps() != null
                && Boolean.TRUE.equals(input.forwardedProps().get("debugRaw"));

        return resolveOrCreateSession(threadId)
                .flatMapMany(sessionId -> {
                    // 实测：v2 官方分支 /api/event 是 volatile 的（不回放，订阅前的事件
                    // 永久丢失）——必须先订阅事件流再发 prompt，否则秒回的 tool call
                    // 等早期事件全丢。replay() 缓存 + 立即 connect，translate 稍后订阅时
                    // 仍能拿到 prompt 之前到达的事件。
                    reactor.core.publisher.Flux<ServerSentEvent<String>> hot =
                            streamEvents(sessionId).replay();
                    reactor.core.Disposable conn = ((reactor.core.publisher.ConnectableFlux<ServerSentEvent<String>>) hot).connect();
                    Flux<ServerSentEvent<String>> translated = translator.translate(finalThreadId, finalRunId, frontendToolNames, hot,
                                    // AG-UI shared state: 会话初始快照（模型/工作区/contextSize），
                                    // 客户端 useAgent().state 可见；contextSize 由 STATE_DELTA 续更
                                    Map.of("threadId", finalThreadId, "model", modelId,
                                            "provider", providerId, "workspace", dataWorkspace,
                                            "contextSize", 0),
                                    // 2026-08-15 实测回归：截断式终止（原生 server/frontend 工具、
                                    // prompt 契约 frontend 工具）后 opencode 仍在跑，尾随事件会
                                    // 流入同 session 的下一个 run（旧回答污染新回答）——abort 掉
                                    () -> abortSession(sessionId).subscribe())
                            // vision-P1: RUN_FINISHED 前插 MESSAGES_SNAPSHOT —— 以 OpenCode
                            // session 历史为权威对账客户端消息流（delta 丢失自愈）；空历史
                            // 跳过（空数组会清掉客户端消息，宁可不发）
                            .concatMap(ev -> {
                                String d = ev.data();
                                if (d != null && d.contains("\"type\":\"RUN_FINISHED\"")) {
                                    return messagesSnapshot(sessionId, finalThreadId, finalRunId)
                                            .map(snap -> Flux.just(snap, ev))
                                            .defaultIfEmpty(Flux.just(ev))
                                            .flatMapMany(f -> f);
                                }
                                return Flux.just(ev);
                            });
                    Flux<ServerSentEvent<String>> stream = debugRaw
                            ? translated.mergeWith(hot.map(this::rawEcho))
                            : translated;
                    return ensureModel(sessionId)
                                .then(sendPrompt(sessionId, finalPrompt))
                                .thenMany(stream)
                                .doFinally(sig -> conn.dispose())
                                // 需求7-6: never let a run hang silently — idle timeout
                                // (question/permission waits, provider stalls) terminates
                                // with a retryable RUN_ERROR, and the lingering OpenCode
                                // session run is aborted so it stops burning tokens.
                                .timeout(runIdleTimeout)
                                .onErrorResume(e -> {
                                    String msg = (e instanceof TimeoutException)
                                            ? "运行超时（" + runIdleTimeout.getSeconds() + "s 无响应），agent 可能已挂起，请重试"
                                            : String.valueOf(e.getMessage());
                                    log.warn("AG-UI run aborted thread={} session={}: {}", finalThreadId, sessionId, msg);
                                    return abortSession(sessionId)
                                            .thenMany(Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"" + escape(msg) + "\"}")));
                                })
                                .doOnSubscribe(s -> log.info("AG-UI run started thread={} run={} session={} user={}", finalThreadId, finalRunId, sessionId, userId))
                                .doOnError(e -> log.error("AG-UI run failed thread={}: {}", finalThreadId, e.getMessage()))
                                // P9-①: 客户端停止（浏览器 abort → SSE 取消）→ 主动中断
                                // OpenCode session，不再白烧 token（此前只在超时路径 abort）
                                .doOnCancel(() -> {
                                    log.info("AG-UI run cancelled by client thread={} session={} — aborting", finalThreadId, sessionId);
                                    abortSession(sessionId).subscribe();
                                });
                })
                .onErrorResume(e -> Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"" + escape(String.valueOf(e.getMessage())) + "\"}")));
    }

    /** P8: 事件流插桩 —— RUN_FINISHED/RUN_ERROR 收尾；TOOL_CALL_START/END 计时。 */
    private void tapMetrics(String runId, String threadId, ServerSentEvent<String> e) {
        String d = e.data();
        if (d == null) return;
        try {
            if (d.contains("\"type\":\"RUN_FINISHED\"")) {
                metrics.runFinished(runId, threadId, "completed");
            } else if (d.contains("\"type\":\"RUN_ERROR\"")) {
                metrics.runFinished(runId, threadId, "error");
            } else if (d.contains("\"type\":\"TOOL_CALL_START\"")) {
                JsonNode n = MAPPER.readTree(d);
                metrics.toolCallStarted(runId, n.path("toolCallId").asText(),
                        n.path("toolCallName").asText("?"), threadId);
            } else if (d.contains("\"type\":\"TOOL_CALL_END\"")) {
                JsonNode n = MAPPER.readTree(d);
                metrics.toolCallEnded(runId, n.path("toolCallId").asText(), threadId);
            }
        } catch (Exception ex) {
            log.debug("metrics tap skipped: {}", ex.getMessage());
        }
    }

    /** P8: a2uiAction 中的 hitl_confirm/hitl_cancel → hitl_wait 指标。 */
    private void tapHitlMetric(String threadId, Object rawAction) {
        try {
            JsonNode action = MAPPER.valueToTree(rawAction);
            JsonNode ev = action.path("action");
            String name = ev.path("name").asText("");
            if (!name.startsWith("hitl_")) return;
            String actionId = ev.path("context").path("actionId").asText("");
            if (actionId.isBlank()) return;
            metrics.hitlResolved(threadId, actionId,
                    "hitl_confirm".equals(name) ? "confirm" : "cancel");
        } catch (Exception ex) {
            log.debug("hitl metric tap skipped: {}", ex.getMessage());
        }
    }

    /**
     * vision-P1: MESSAGES_SNAPSHOT —— 拉 OpenCode session 历史转 AG-UI Message[]。
     * 空历史/拉取失败 → empty（调用方跳过发送；空数组 snapshot 会清客户端消息）。
     */
    private Mono<ServerSentEvent<String>> messagesSnapshot(String sessionId, String threadId, String runId) {
        return webClient.get()
                .uri("/api/session/{id}/message", sessionId)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .flatMap(body -> {
                    List<JsonNode> msgs = messagesService.toAguiMessages(body);
                    if (msgs.isEmpty()) return Mono.empty();
                    var n = MAPPER.createObjectNode();
                    n.put("type", "MESSAGES_SNAPSHOT");
                    n.put("threadId", threadId);
                    n.put("runId", runId);
                    n.putArray("messages").addAll(msgs.stream().map(m -> (JsonNode) m).toList());
                    return Mono.just(sseRaw(toJson(n)));
                })
                .onErrorResume(e -> {
                    log.debug("messages snapshot skipped for session {}: {}", sessionId, e.getMessage());
                    return Mono.empty();
                });
    }

    /** vision-P1: RAW 事件回显（debugRaw 通道）——OpenCode 原始事件对象内嵌。 */
    private ServerSentEvent<String> rawEcho(ServerSentEvent<String> raw) {
        String data = raw.data();
        String embedded;
        try {
            embedded = MAPPER.readTree(data == null ? "{}" : data).toString();
        } catch (Exception e) {
            embedded = "\"" + escape(String.valueOf(data)) + "\"";
        }
        return sseRaw("{\"type\":\"RAW\",\"source\":\"opencode\",\"event\":" + embedded + "}");
    }

    private static String toJson(com.fasterxml.jackson.databind.node.ObjectNode n) {
        return n.toString();
    }

    /** Best-effort abort of the OpenCode-side run; failures are logged and swallowed. */    private Mono<Void> abortSession(String sessionId) {
        // v2 官方分支是 POST /api/session/{id}/interrupt；旧打包二进制是 /abort
        return webClient.post()
                .uri("/api/session/{id}/interrupt", sessionId)
                .retrieve()
                .toBodilessEntity()
                .then()
                .onErrorResume(e -> webClient.post()
                        .uri("/api/session/{id}/abort", sessionId)
                        .retrieve()
                        .toBodilessEntity()
                        .then())
                .doOnSuccess(v -> log.info("aborted OpenCode session {}", sessionId))
                .onErrorResume(e -> {
                    log.warn("failed to abort OpenCode session {}: {}", sessionId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * 需求1: threadId→sessionId 映射持久化在 {@link ChatThreadStore}；
     * 复用前先存活校验（GET /api/session/{id}），失效（重启后 wedge / 404）
     * 自动创建新 session 并重新绑定，避免整线程报废。
     */
    private Mono<String> resolveOrCreateSession(String threadId) {
        String existing = threadStore.resolveSession(threadId);
        Mono<String> create = webClient.post()
                .uri("/api/session")
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .map(node -> {
                    String sessionId = node.path("data").path("id").asText();
                    if (sessionId.isBlank()) throw new IllegalStateException("session create returned no id");
                    threadStore.bindSession(threadId, sessionId);
                    return sessionId;
                });
        if (existing == null) return create;
        return webClient.get()
                .uri("/api/session/{id}", existing)
                .retrieve()
                .toBodilessEntity()
                .map(r -> existing)
                .onErrorResume(e -> {
                    log.warn("session {} for thread {} is stale ({}), recreating",
                            existing, threadId, e.getMessage());
                    return create;
                });
    }

    private Mono<Void> ensureModel(String sessionId) {
        return webClient.post()
                .uri("/api/session/{id}/model", sessionId)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of("model", Map.of("id", modelId, "providerID", providerId)))
                .retrieve()
                .toBodilessEntity()
                .then();
    }

    private Mono<Void> sendPrompt(String sessionId, String message) {
        // v2 官方分支 payload 是 {text}；旧打包二进制是 {prompt:{text}} —— 400 时回退
        return webClient.post()
                .uri("/api/session/{id}/prompt", sessionId)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of("text", message))
                .retrieve()
                .toBodilessEntity()
                .then()
                .onErrorResume(e -> {
                    if (!String.valueOf(e.getMessage()).contains("400")) return Mono.error(e);
                    log.info("session {} rejects {text} payload, retrying legacy {prompt:{text}} shape", sessionId);
                    return webClient.post()
                            .uri("/api/session/{id}/prompt", sessionId)
                            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                            .bodyValue(Map.of("prompt", Map.of("text", message)))
                            .retrieve()
                            .toBodilessEntity()
                            .then();
                });
    }

    private Flux<ServerSentEvent<String>> streamEvents(String sessionId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder.path("/api/event").queryParam("sessionID", sessionId).build())
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchangeToFlux(response -> {
                    if (!response.statusCode().is2xxSuccessful()) {
                        return response.bodyToMono(String.class)
                                .flatMapMany(body -> Flux.error(new IllegalStateException("event stream " + response.statusCode() + ": " + body)));
                    }
                    return response.body(BodyExtractors.toFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {}));
                })
                .filter(e -> e.data() != null && !e.data().isBlank())
                // 实测：/api/event 是全局流（所有 session 混合，子 agent 的 child
                // session 也在其中且有独立 aggregate seq）—— 只放行本会话事件，
                // 否则跨会话串扰 + seq 冲突（不同 aggregate 的 seq 会重复）。
                .filter(e -> {
                    try {
                        String sid = new com.fasterxml.jackson.databind.ObjectMapper()
                                .readTree(e.data()).path("data").path("sessionID").asText("");
                        return sid.isEmpty() || sessionId.equals(sid);
                    } catch (Exception ex) {
                        return false;
                    }
                })
                // Terminate the flux only at a RUN-terminating step settlement.
                // OpenCode emits step.ended per assistant turn; finish=tool-calls means
                // the agent loop continues with more steps — cutting the stream there
                // was the root cause of the "one message then dead air" bug (需求7).
                .takeUntil(e -> {
                    try {
                        com.fasterxml.jackson.databind.JsonNode n =
                                new com.fasterxml.jackson.databind.ObjectMapper().readTree(e.data());
                        String t = n.path("type").asText();
                        if ("session.step.failed".equals(t)) return true;
                        if ("session.execution.succeeded".equals(t)) return true;
                        if ("session.execution.failed".equals(t)) return true;
                        if ("session.step.ended".equals(t)) {
                            String finish = n.path("data").path("finish").asText("stop");
                            return !"tool-calls".equals(finish);
                        }
                        return false;
                    } catch (Exception ex) {
                        return false;
                    }
                });
    }

    /**
     * task6: 用户消息的多模态内容 —— text 为拼接后的文本（无文本 part 时为空串），
     * attachments 为附件文件名列表（来自 content part 的 metadata.filename，
     * ChatGPT 式上传：文件已落盘会话工作目录，prompt 只需文件名）。
     */
    record UserContent(String text, List<String> attachments) {}

    /**
     * 提取最后一条用户消息。content 可能是纯字符串，也可能是 AG-UI 多模态
     * parts 数组（[{type:"text",text:...}, {type:"document",metadata:{filename}}...]）。
     */
    private UserContent extractLastUserContent(List<Map<String, Object>> messages) {
        if (messages == null) return null;
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> m = messages.get(i);
            Object role = m.get("role");
            if (role == null || !"user".equals(String.valueOf(role))) continue;
            Object content = m.get("content");
            if (content == null) return null;
            if (content instanceof List<?> parts) {
                StringBuilder text = new StringBuilder();
                List<String> attachments = new java.util.ArrayList<>();
                for (Object part : parts) {
                    if (!(part instanceof Map<?, ?> pm)) continue;
                    Object ptype = pm.get("type");
                    if ("text".equals(String.valueOf(ptype))) {
                        Object t = pm.get("text");
                        if (t != null) {
                            if (text.length() > 0) text.append('\n');
                            text.append(t);
                        }
                    }
                    Object meta = pm.get("metadata");
                    if (meta instanceof Map<?, ?> mm) {
                        Object fn = mm.get("filename");
                        if (fn != null && !String.valueOf(fn).isBlank()) {
                            attachments.add(String.valueOf(fn));
                        }
                    }
                }
                return new UserContent(text.toString(), List.copyOf(attachments));
            }
            return new UserContent(String.valueOf(content), List.of());
        }
        return null;
    }

    /**
     * Loose request validation. Deliberately lenient thresholds (TASK §16:
     * no auth in this environment — parameter positions are reserved and
     * threadId binding stays server-side; TODO: real auth later).
     */
    private String validate(RunAgentInput input, String runId) {
        if (!runId.matches("[A-Za-z0-9_\\-.]{1,128}")) return "invalid runId format";
        if (input.threadId() != null && (!input.threadId().matches("[A-Za-z0-9_\\-.]{1,128}")
                || input.threadId().contains("..")))  // task6: threadId 用于拼 workspace 路径，排除穿越形态
            return "invalid threadId format";
        List<Map<String, Object>> messages = input.messages();
        if (messages != null) {
            if (messages.size() > 200) return "too many messages";
            for (Map<String, Object> m : messages) {
                Object content = m.get("content");
                if (content != null && String.valueOf(content).length() > 64 * 1024)
                    return "message content too large";
            }
        }
        return null;
    }

    private ServerSentEvent<String> sseRaw(String json) {
        return ServerSentEvent.<String>builder().data(json).build();
    }

    private String escape(String s) {
        return s == null ? "" : s.replace("\"", "'").replace("\n", " ");
    }
}
