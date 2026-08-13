package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 需求1: 会话持久化存储（零外部依赖，单 JSON 文件 + 原子写）。
 *
 * <p>持久化内容：
 * <ul>
 *   <li>thread 元数据（id/title/createdAt/updatedAt）——标题取首条用户消息截断</li>
 *   <li>threadId → OpenCode sessionId 映射（gateway 重启不丢）</li>
 *   <li>每个 thread 的 A2UI surface 最新快照（切换/刷新后看板可重放）</li>
 * </ul>
 *
 * <p>消息正文不落盘 —— OpenCode 自身持久化 session 历史，messages API 实时拉取转换。</p>
 */
public class ChatThreadStore {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int TITLE_MAX = 30;

    private final Path file;

    public ChatThreadStore(Path dir) {
        this.file = dir.resolve("threads.json");
    }

    public record SurfaceRecord(String surfaceId, String content, Instant updatedAt) {}

    // ---------------------------------------------------------- threads ---

    public synchronized ChatThread createThread(String id, String title) {
        ObjectNode root = load();
        ObjectNode threads = threadsNode(root);
        Instant now = Instant.now();
        ObjectNode t = MAPPER.createObjectNode();
        t.put("id", id);
        t.put("title", (title == null || title.isBlank()) ? "新会话" : title);
        t.put("createdAt", now.toString());
        t.put("updatedAt", now.toString());
        t.putNull("sessionId");
        threads.set(id, t);
        save(root);
        return toThread(t);
    }

    public synchronized List<ChatThread> listThreads() {
        List<ChatThread> out = new ArrayList<>();
        threadsNode(load()).fields().forEachRemaining(e -> out.add(toThread(e.getValue())));
        out.sort(Comparator.comparing(ChatThread::updatedAt).reversed());
        return out;
    }

    public synchronized Optional<ChatThread> getThread(String id) {
        JsonNode t = threadsNode(load()).get(id);
        return t == null ? Optional.empty() : Optional.of(toThread(t));
    }

    public synchronized void renameThread(String id, String title) {
        ObjectNode root = load();
        JsonNode t = threadsNode(root).get(id);
        if (t instanceof ObjectNode o && title != null && !title.isBlank()) {
            o.put("title", title);
            save(root);
        }
    }

    public synchronized void deleteThread(String id) {
        ObjectNode root = load();
        threadsNode(root).remove(id);
        surfacesNode(root).remove(id);
        save(root);
    }

    /** Bump updatedAt（列表排序用）。 */
    public synchronized void touch(String id) {
        ObjectNode root = load();
        JsonNode t = threadsNode(root).get(id);
        if (t instanceof ObjectNode o) {
            o.put("updatedAt", Instant.now().toString());
            save(root);
        }
    }

    /** 标题取首条用户消息截断；已有非默认标题不覆盖。 */
    public synchronized void setTitleFromFirstMessage(String id, String firstUserMessage) {
        if (firstUserMessage == null || firstUserMessage.isBlank()) return;
        ObjectNode root = load();
        JsonNode t = threadsNode(root).get(id);
        if (!(t instanceof ObjectNode o)) return;
        if (!"新会话".equals(o.path("title").asText())) return;
        String title = firstUserMessage.strip().replaceAll("\\s+", " ");
        if (title.length() > TITLE_MAX) title = title.substring(0, TITLE_MAX) + "…";
        o.put("title", title);
        save(root);
    }

    // ---------------------------------------------------------- session ---

    public synchronized String resolveSession(String threadId) {
        JsonNode t = threadsNode(load()).get(threadId);
        if (t == null) return null;
        String sid = t.path("sessionId").asText(null);
        return (sid == null || sid.isBlank()) ? null : sid;
    }

    public synchronized void bindSession(String threadId, String sessionId) {
        ObjectNode root = load();
        JsonNode t = threadsNode(root).get(threadId);
        if (t instanceof ObjectNode o) {
            o.put("sessionId", sessionId);
            save(root);
        }
    }

    // --------------------------------------------------------- surfaces ---

    public synchronized void saveSurface(String threadId, String surfaceId, String content) {
        ObjectNode root = load();
        ObjectNode per = surfacesNode(root).withObject(threadId);
        ObjectNode rec = MAPPER.createObjectNode();
        rec.put("surfaceId", surfaceId);
        rec.put("content", content);
        rec.put("updatedAt", Instant.now().toString());
        per.set(surfaceId, rec);
        save(root);
    }

    public synchronized List<SurfaceRecord> listSurfaces(String threadId) {
        List<SurfaceRecord> out = new ArrayList<>();
        JsonNode per = surfacesNode(load()).get(threadId);
        if (per != null) {
            per.fields().forEachRemaining(e -> out.add(new SurfaceRecord(
                    e.getValue().path("surfaceId").asText(),
                    e.getValue().path("content").asText(),
                    Instant.parse(e.getValue().path("updatedAt").asText()))));
        }
        out.sort(Comparator.comparing(SurfaceRecord::updatedAt));
        return out;
    }

    // ----------------------------------------------------------- helper ---

    private ObjectNode threadsNode(ObjectNode root) {
        if (!(root.get("threads") instanceof ObjectNode)) root.set("threads", MAPPER.createObjectNode());
        return (ObjectNode) root.get("threads");
    }

    private ObjectNode surfacesNode(ObjectNode root) {
        if (!(root.get("surfaces") instanceof ObjectNode)) root.set("surfaces", MAPPER.createObjectNode());
        return (ObjectNode) root.get("surfaces");
    }

    private ChatThread toThread(JsonNode t) {
        return new ChatThread(
                t.path("id").asText(),
                t.path("title").asText("新会话"),
                t.path("sessionId").isNull() ? null : t.path("sessionId").asText(null),
                Instant.parse(t.path("createdAt").asText()),
                Instant.parse(t.path("updatedAt").asText()));
    }

    private ObjectNode load() {
        try {
            if (Files.exists(file)) {
                String text = Files.readString(file, StandardCharsets.UTF_8);
                JsonNode n = MAPPER.readTree(text);
                if (n instanceof ObjectNode o) return o;
            }
        } catch (Exception e) {
            // 损坏的存储文件不应击垮服务 —— 从空开始（调用方可重建）
        }
        return MAPPER.createObjectNode();
    }

    private void save(ObjectNode root) {
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root),
                    StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new UncheckedIOException("failed to persist " + file, e);
        }
    }

    // 供 messages API 使用：thread 记录的 JSON 表示
    public record ChatThread(String id, String title, String sessionId, Instant createdAt, Instant updatedAt) {
        public ObjectNode toJson() {
            ObjectNode n = MAPPER.createObjectNode();
            n.put("id", id);
            n.put("title", title);
            if (sessionId == null) n.putNull("sessionId"); else n.put("sessionId", sessionId);
            n.put("createdAt", createdAt.toString());
            n.put("updatedAt", updatedAt.toString());
            return n;
        }

        public static ArrayNode listToJson(List<ChatThread> threads) {
            ArrayNode arr = MAPPER.createArrayNode();
            threads.forEach(t -> arr.add(t.toJson()));
            return arr;
        }
    }
}
