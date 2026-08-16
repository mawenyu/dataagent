package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 需求1: 多会话管理 REST API（语义化 URL，不含 opencode 字样）。
 *
 * <ul>
 *   <li>GET    /chat/threads —— 会话列表（按更新时间倒序）</li>
 *   <li>POST   /chat/threads {id?, title?} —— 新建</li>
 *   <li>PATCH  /chat/threads/{id} {title} —— 重命名</li>
 *   <li>DELETE /chat/threads/{id} —— 删除（连同持久化的 surfaces）</li>
 *   <li>GET    /chat/threads/{id}/messages —— 历史消息（实时从 OpenCode
 *       session 拉取并转 AG-UI Message[]，尾部追加持久化的 A2UI surface
 *       activity 消息）</li>
 * </ul>
 */
@RestController
@RequestMapping("/chat/threads")
public class ChatThreadsController {

    private static final Logger log = LoggerFactory.getLogger(ChatThreadsController.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ThreadRepository store;
    private final ThreadMessagesService messagesService;
    private final WebClient webClient;
    private final WorkspaceFileService workspaceFiles;

    public ChatThreadsController(ThreadRepository store, ThreadMessagesService messagesService,
                                 WebClient opencodeWebClient, WorkspaceFileService workspaceFiles) {
        this.store = store;
        this.messagesService = messagesService;
        this.webClient = opencodeWebClient;
        this.workspaceFiles = workspaceFiles;
    }

    // P2-9b: ThreadRepository（现 JsonThreadRepository 是 synchronized 单文件 JSON
    // store，同步磁盘 IO），
    // WorkspaceFileService.deleteThreadDir 递归删目录 —— WebFlux handler 线程即
    // event loop，一律经 boundedElastic 下移；响应体/状态码契约不变。

    @GetMapping
    public Mono<JsonNode> list() {
        return Mono.fromCallable(() -> {
            ObjectNode res = MAPPER.createObjectNode();
            res.set("data", ThreadRepository.ChatThread.listToJson(store.listThreads()));
            return (JsonNode) res;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    public Mono<JsonNode> create(@RequestBody(required = false) Map<String, String> body) {
        String id = body != null && body.get("id") != null && !body.get("id").isBlank()
                ? body.get("id") : UUID.randomUUID().toString();
        String title = body != null ? body.get("title") : null;
        return Mono.fromCallable(() -> {
            ObjectNode res = MAPPER.createObjectNode();
            res.set("data", store.createThread(id, title).toJson());
            return (JsonNode) res;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PatchMapping("/{id}")
    public Mono<ResponseEntity<JsonNode>> rename(@PathVariable String id, @RequestBody Map<String, String> body) {
        return Mono.<ResponseEntity<JsonNode>>fromCallable(() -> {
            if (store.getThread(id).isEmpty()) return ResponseEntity.<JsonNode>notFound().build();
            store.renameThread(id, body.get("title"));
            ObjectNode res = MAPPER.createObjectNode();
            res.set("data", store.getThread(id).orElseThrow().toJson());
            return ResponseEntity.ok((JsonNode) res);
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<JsonNode>> delete(@PathVariable String id) {
        return Mono.<ResponseEntity<JsonNode>>fromCallable(() -> {
            if (store.getThread(id).isEmpty()) return ResponseEntity.<JsonNode>notFound().build();
            store.deleteThread(id);
            // task6: 级联删除会话工作目录（workspace/threads/{id}）
            workspaceFiles.deleteThreadDir(id);
            ObjectNode res = MAPPER.createObjectNode();
            res.put("data", true);
            return ResponseEntity.ok((JsonNode) res);
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * P-Q: POST /chat/threads/{id}/branch {messageId, newThreadId?} ——
     * 从任意历史消息分叉:复制该消息之前(user/assistant 文本)的上下文为
     * 新会话前缀(快照落盘),首个 run 一次性注入 <forked_context>。
     */
    @PostMapping("/{id}/branch")
    public Mono<ResponseEntity<JsonNode>> branch(@PathVariable String id,
                                                 @RequestBody Map<String, String> body) {
        String messageId = body.get("messageId");
        String newId = body.getOrDefault("newThreadId", UUID.randomUUID().toString());
        // P2-9b: store 读写在 defer+boundedElastic 内；分叉建档（写盘）在
        // publishOn 之后的 map 中，不占用 WebClient 回调的 event loop。
        return Mono.<ResponseEntity<JsonNode>>defer(() -> {
            var parent = store.getThread(id);
            if (parent.isEmpty()) return Mono.just(ResponseEntity.<JsonNode>notFound().build());
            if (messageId == null || messageId.isBlank()) {
                ObjectNode err = MAPPER.createObjectNode();
                err.put("error", "messageId required");
                return Mono.just(ResponseEntity.badRequest().body((JsonNode) err));
            }
            // 有效消息序列 = 父会话自身前缀(分叉链)+ 其 session 消息
            List<JsonNode> parentPrefix = store.forkPrefixMessages(id);
            String sessionId = store.resolveSession(id);
            Mono<List<JsonNode>> ownMessages = sessionId == null
                    ? Mono.just(List.of())
                    : messagesService.fetchAguiMessages(webClient, sessionId)
                            .onErrorReturn(List.of());
            return ownMessages.publishOn(Schedulers.boundedElastic()).map(own -> {
                List<JsonNode> all = new ArrayList<>(parentPrefix);
                all.addAll(own);
                boolean found = all.stream().anyMatch(m -> m.path("id").asText().equals(messageId));
                if (!found) {
                    ObjectNode err = MAPPER.createObjectNode();
                    err.put("error", "messageId not found in thread history");
                    return ResponseEntity.badRequest().body((JsonNode) err);
                }
                var prefix = messagesService.simplifyForFork(all, messageId);
                var created = store.createBranch(newId, id, parent.get().title(), messageId, prefix);
                ObjectNode res = MAPPER.createObjectNode();
                res.set("data", created.toJson());
                return ResponseEntity.ok((JsonNode) res);
            });
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}/messages")
    public Mono<JsonNode> messages(@PathVariable String id) {
        // P2-9b: store 三次同步读（session/surfaces/分叉前缀）移出 event loop
        return Mono.defer(() -> {
            String sessionId = store.resolveSession(id);
            List<ThreadRepository.SurfaceRecord> surfaces = store.listSurfaces(id);
            // P-Q: 分叉前缀(若有)始终并入历史头部
            List<JsonNode> prefix = store.forkPrefixMessages(id);
            if (sessionId == null) {
                return Mono.just(messagesResponse(prefix, surfaces));
            }
            return messagesService.fetchAguiMessages(webClient, sessionId)
                    .map(msgs -> {
                        List<JsonNode> merged = new ArrayList<>(prefix);
                        merged.addAll(msgs);
                        return messagesResponse(merged, surfaces);
                    })
                    .onErrorResume(e -> {
                        log.warn("failed to load history for thread {} (session {}): {}", id, sessionId, e.getMessage());
                        return Mono.just(messagesResponse(List.of(), surfaces));
                    });
        }).subscribeOn(Schedulers.boundedElastic());
    }

    private JsonNode messagesResponse(List<JsonNode> messages, List<ThreadRepository.SurfaceRecord> surfaces) {
        ArrayNode arr = MAPPER.createArrayNode();
        messages.forEach(arr::add);
        // A2UI surface 回放：追加为 activity 消息（与实时流的 ACTIVITY_SNAPSHOT 同构）
        for (ThreadRepository.SurfaceRecord s : surfaces) {
            try {
                ObjectNode am = MAPPER.createObjectNode();
                am.put("id", "a2ui-" + s.surfaceId());
                am.put("role", "activity");
                am.put("activityType", "a2ui-surface");
                am.set("content", MAPPER.readTree(s.content()));
                arr.add(am);
            } catch (Exception e) {
                log.debug("surface {} content unparseable, skipped", s.surfaceId());
            }
        }
        ObjectNode res = MAPPER.createObjectNode();
        res.set("data", arr);
        return res;
    }
}
