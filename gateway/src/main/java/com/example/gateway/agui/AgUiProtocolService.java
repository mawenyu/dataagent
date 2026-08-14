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

    /** Convenience constructor for tests — default everything, throwaway temp store. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, DEFAULT_RUN_IDLE_TIMEOUT, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore());
    }

    /** Convenience constructor for tests — custom idle timeout. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               Duration runIdleTimeout) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, runIdleTimeout, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore());
    }

    /** Convenience constructor for tests — store given (需求1 persistence assertions). */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               ChatThreadStore threadStore) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, DEFAULT_RUN_IDLE_TIMEOUT, DEFAULT_DATA_WORKSPACE,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, threadStore);
    }

    /** Convenience constructor for tests — custom timeout + workspace, default model. */
    public AgUiProtocolService(WebClient opencodeWebClient, AguiEventTranslator translator,
                               FrontendToolBridge toolBridge,
                               A2UiBridgeService a2UiBridge, A2UiActionHandler actionHandler,
                               ThreadAccessPolicy threadAccessPolicy,
                               Duration runIdleTimeout, String dataWorkspace) {
        this(opencodeWebClient, translator, toolBridge, a2UiBridge, actionHandler, threadAccessPolicy, runIdleTimeout, dataWorkspace,
                DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, throwawayStore());
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
                               ChatThreadStore threadStore) {
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
    }

    private static ChatThreadStore throwawayStore() {
        try {
            return new ChatThreadStore(java.nio.file.Files.createTempDirectory("agui-threads-test"));
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
        String firstUser = extractLastUserMessage(input.messages());
        if (firstUser != null) threadStore.setTitleFromFirstMessage(threadId, firstUser);
        threadStore.touch(threadId);

        return doRun(input, uid, threadId, runId)
                .doOnNext(e -> persistSurfaceSnapshot(threadId, e));
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

    private Flux<ServerSentEvent<String>> doRun(RunAgentInput input, String uid, String threadId, String runId) {

        // 需求2: A2UI action 回传一律走真实 agent 续跑（无任何 Java 侧 if/else
        // 固定 surface）。action 被翻译成 A2UI_ACTION prompt，由 agent 判断并
        // 用 render_a2ui 更新同名 surface。
        if (input.forwardedProps() != null && input.forwardedProps().containsKey("a2uiAction")) {
            Object rawAction = input.forwardedProps().get("a2uiAction");
            log.info("A2UI action received on thread {} (user={}): {}", threadId, uid, rawAction);
            StringBuilder p = new StringBuilder();
            if (a2UiBridge.hasA2uiContext(input.context())) {
                p.append(a2UiBridge.buildServerToolSection(input.context())).append("\n\n");
            }
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
            String userMessage = extractLastUserMessage(input.messages());
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
            p.append("<environment>\n数据工作目录: ").append(dataWorkspace)
                    .append("\n用户的数据文件（如销售 CSV）放在该目录；分析数据问题时先在此目录查找，回答用中文。\n</environment>\n\n");
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

        return resolveOrCreateSession(threadId)
                .flatMapMany(sessionId -> {
                    // 实测：v2 官方分支 /api/event 是 volatile 的（不回放，订阅前的事件
                    // 永久丢失）——必须先订阅事件流再发 prompt，否则秒回的 tool call
                    // 等早期事件全丢。replay() 缓存 + 立即 connect，translate 稍后订阅时
                    // 仍能拿到 prompt 之前到达的事件。
                    reactor.core.publisher.Flux<ServerSentEvent<String>> hot =
                            streamEvents(sessionId).replay();
                    reactor.core.Disposable conn = ((reactor.core.publisher.ConnectableFlux<ServerSentEvent<String>>) hot).connect();
                    return ensureModel(sessionId)
                                .then(sendPrompt(sessionId, finalPrompt))
                                .thenMany(translator.translate(finalThreadId, finalRunId, frontendToolNames, hot))
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
                                .doOnError(e -> log.error("AG-UI run failed thread={}: {}", finalThreadId, e.getMessage()));
                })
                .onErrorResume(e -> Flux.just(sseRaw("{\"type\":\"RUN_ERROR\",\"message\":\"" + escape(String.valueOf(e.getMessage())) + "\"}")));
    }

    /** Best-effort abort of the OpenCode-side run; failures are logged and swallowed. */
    private Mono<Void> abortSession(String sessionId) {
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
                // v2 官方分支方言归一化（session.X → session.next.X），新旧服务端都兼容
                .map(AguiEventTranslator::normalizeDialect)
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
                        if ("session.next.step.failed".equals(t)) return true;
                        if ("session.next.step.ended".equals(t)) {
                            String finish = n.path("data").path("finish").asText("stop");
                            return !"tool-calls".equals(finish);
                        }
                        return false;
                    } catch (Exception ex) {
                        return false;
                    }
                });
    }

    private String extractLastUserMessage(List<Map<String, Object>> messages) {
        if (messages == null) return null;
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> m = messages.get(i);
            Object role = m.get("role");
            if (role != null && "user".equals(String.valueOf(role))) {
                Object content = m.get("content");
                if (content != null) return String.valueOf(content);
            }
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
        if (input.threadId() != null && !input.threadId().matches("[A-Za-z0-9_\\-.]{1,128}"))
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
