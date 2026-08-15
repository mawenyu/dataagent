package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
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

    private final ChatThreadStore store;
    private final ThreadMessagesService messagesService;
    private final WebClient webClient;
    private final WorkspaceFileService workspaceFiles;

    public ChatThreadsController(ChatThreadStore store, ThreadMessagesService messagesService,
                                 WebClient opencodeWebClient, WorkspaceFileService workspaceFiles) {
        this.store = store;
        this.messagesService = messagesService;
        this.webClient = opencodeWebClient;
        this.workspaceFiles = workspaceFiles;
    }

    @GetMapping
    public JsonNode list() {
        ObjectNode res = MAPPER.createObjectNode();
        res.set("data", ChatThreadStore.ChatThread.listToJson(store.listThreads()));
        return res;
    }

    @PostMapping
    public JsonNode create(@RequestBody(required = false) Map<String, String> body) {
        String id = body != null && body.get("id") != null && !body.get("id").isBlank()
                ? body.get("id") : UUID.randomUUID().toString();
        String title = body != null ? body.get("title") : null;
        ObjectNode res = MAPPER.createObjectNode();
        res.set("data", store.createThread(id, title).toJson());
        return res;
    }

    @PatchMapping("/{id}")
    public ResponseEntity<JsonNode> rename(@PathVariable String id, @RequestBody Map<String, String> body) {
        if (store.getThread(id).isEmpty()) return ResponseEntity.notFound().build();
        store.renameThread(id, body.get("title"));
        ObjectNode res = MAPPER.createObjectNode();
        res.set("data", store.getThread(id).orElseThrow().toJson());
        return ResponseEntity.ok(res);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<JsonNode> delete(@PathVariable String id) {
        if (store.getThread(id).isEmpty()) return ResponseEntity.notFound().build();
        store.deleteThread(id);
        // task6: 级联删除会话工作目录（workspace/threads/{id}）
        workspaceFiles.deleteThreadDir(id);
        ObjectNode res = MAPPER.createObjectNode();
        res.put("data", true);
        return ResponseEntity.ok(res);
    }

    @GetMapping("/{id}/messages")
    public Mono<JsonNode> messages(@PathVariable String id) {
        String sessionId = store.resolveSession(id);
        List<ChatThreadStore.SurfaceRecord> surfaces = store.listSurfaces(id);
        if (sessionId == null) {
            return Mono.just(messagesResponse(List.of(), surfaces));
        }
        return webClient.get()
                .uri("/api/session/{sid}/message", sessionId)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .map(body -> messagesResponse(messagesService.toAguiMessages(body), surfaces))
                .onErrorResume(e -> {
                    log.warn("failed to load history for thread {} (session {}): {}", id, sessionId, e.getMessage());
                    return Mono.just(messagesResponse(List.of(), surfaces));
                });
    }

    private JsonNode messagesResponse(List<JsonNode> messages, List<ChatThreadStore.SurfaceRecord> surfaces) {
        ArrayNode arr = MAPPER.createArrayNode();
        messages.forEach(arr::add);
        // A2UI surface 回放：追加为 activity 消息（与实时流的 ACTIVITY_SNAPSHOT 同构）
        for (ChatThreadStore.SurfaceRecord s : surfaces) {
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
