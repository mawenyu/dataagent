package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * TARGET_ARCH §3: 会话持久化抽象 —— 调用方（controller/service）面向本接口，
 * 当前实现是 {@link JsonThreadRepository}（单 JSON 文件），将来可换 SQLite 实现。
 *
 * <p>契约要点（实现必须遵守）：
 * <ul>
 *   <li>方法级线程安全（现实现用 synchronized 方法 + 原子写）；</li>
 *   <li>同步阻塞语义 —— 调用方负责把调用移下 event loop（P2-9b: boundedElastic）；</li>
 *   <li>消息正文不在此持久化 —— OpenCode session 历史是事实源。</li>
 * </ul>
 */
public interface ThreadRepository {

    // ---------------------------------------------------------- threads ---

    /** 建档（标题空则默认"新会话"）。 */
    ChatThread createThread(String id, String title);

    /** 按 updatedAt 倒序。 */
    List<ChatThread> listThreads();

    Optional<ChatThread> getThread(String id);

    void renameThread(String id, String title);

    /** 删除会话连同其持久化 surfaces。 */
    void deleteThread(String id);

    /** Bump updatedAt（列表排序用）。 */
    void touch(String id);

    /** 标题取首条用户消息截断；已有非默认标题不覆盖。 */
    void setTitleFromFirstMessage(String id, String firstUserMessage);

    // ---------------------------------------------------------- P-Q 分叉 ---

    /** 分叉建档 —— 新会话携带 branchedFrom 与 forkPrefix，forkContextPending=true。 */
    ChatThread createBranch(String newId, String parentId, String parentTitle,
                            String messageId, List<Map<String, String>> prefix);

    /** 分叉前缀消息(id/role/content，与转换后 AG-UI 消息同构)，无 → 空。 */
    List<JsonNode> forkPrefixMessages(String id);

    /** 首个 run 的一次性上文注入 —— 构建 <forked_context> 块并清标记；非分叉或已注入 → null。 */
    String consumeForkContext(String id);

    // ---------------------------------------------------------- session ---

    /** threadId → OpenCode sessionId，未绑定 → null。 */
    String resolveSession(String threadId);

    void bindSession(String threadId, String sessionId);

    // --------------------------------------------------------- surfaces ---

    /** 保存 surface 最新快照（同 surfaceId 覆盖）。 */
    void saveSurface(String threadId, String surfaceId, String content);

    /** 按 updatedAt 升序（回放顺序）。 */
    List<SurfaceRecord> listSurfaces(String threadId);

    // ------------------------------------------------------------ types ---

    /** A2UI surface 持久化快照记录。 */
    record SurfaceRecord(String surfaceId, String content, Instant updatedAt) {}

    /** 供 messages API 使用：thread 记录的 JSON 表示。 */
    record ChatThread(String id, String title, String sessionId, Instant createdAt, Instant updatedAt,
                      JsonNode branchedFrom) {
        private static final ObjectMapper MAPPER = new ObjectMapper();

        public ObjectNode toJson() {
            ObjectNode n = MAPPER.createObjectNode();
            n.put("id", id);
            n.put("title", title);
            if (sessionId == null) n.putNull("sessionId"); else n.put("sessionId", sessionId);
            n.put("createdAt", createdAt.toString());
            n.put("updatedAt", updatedAt.toString());
            // P-Q: 分叉来源(源会话+分叉消息),侧边栏 ⑂ 标记用
            if (branchedFrom != null) n.set("branchedFrom", branchedFrom);
            return n;
        }

        public static ArrayNode listToJson(List<ChatThread> threads) {
            ArrayNode arr = MAPPER.createArrayNode();
            threads.forEach(t -> arr.add(t.toJson()));
            return arr;
        }
    }
}
