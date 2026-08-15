package com.example.gateway.agui;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 需求1: 会话元数据 + threadId→sessionId 映射 + A2UI surface 的文件持久化。
 * 零外部依赖：store 目录下一个 threads.json（原子写：tmp + move）。
 */
class ChatThreadStoreTest {

    @TempDir
    Path dir;

    private ChatThreadStore store;

    @BeforeEach
    void setUp() {
        store = new ChatThreadStore(dir);
    }

    @Test
    void createAndListThreadsSortedByUpdatedDesc() throws Exception {
        ChatThreadStore.ChatThread a = store.createThread("t-1", null);
        Thread.sleep(5);
        ChatThreadStore.ChatThread b = store.createThread("t-2", null);
        List<ChatThreadStore.ChatThread> list = store.listThreads();
        assertEquals(2, list.size());
        assertEquals("t-2", list.get(0).id(), "newest first");
        assertEquals("新会话", a.title(), "default title");
        assertNull(a.sessionId());
    }

    @Test
    void renameAndDelete() {
        store.createThread("t-1", null);
        store.renameThread("t-1", "销售分析");
        assertEquals("销售分析", store.getThread("t-1").orElseThrow().title());
        store.deleteThread("t-1");
        assertTrue(store.getThread("t-1").isEmpty());
        assertTrue(store.listThreads().isEmpty());
    }

    @Test
    void titleFromFirstUserMessageTruncated() {
        store.createThread("t-1", null);
        store.setTitleFromFirstMessage("t-1", "分析本月销售情况，并用图表看板展示，越详细越好，谢谢");
        String title = store.getThread("t-1").orElseThrow().title();
        assertTrue(title.startsWith("分析本月销售情况"));
        assertTrue(title.length() <= 31, "truncated to ~30 chars + ellipsis");
        // 已有标题不被覆盖
        store.setTitleFromFirstMessage("t-1", "第二轮消息");
        assertEquals(title, store.getThread("t-1").orElseThrow().title());
    }

    @Test
    void sessionBindingPersistsAcrossStoreInstances() {
        store.createThread("t-1", null);
        store.bindSession("t-1", "ses_abc");
        // 模拟 gateway 重启：新实例读同一目录
        ChatThreadStore reloaded = new ChatThreadStore(dir);
        assertEquals("ses_abc", reloaded.resolveSession("t-1"));
    }

    @Test
    void surfaceSnapshotPersistedAndListed() {
        store.createThread("t-1", null);
        store.saveSurface("t-1", "sales-dashboard", "{\"a2ui_operations\":[{}]}");
        store.saveSurface("t-1", "sales-dashboard", "{\"a2ui_operations\":[{},{}]}");
        store.saveSurface("t-1", "other", "{\"a2ui_operations\":[]}");
        List<ChatThreadStore.SurfaceRecord> surfaces = new ChatThreadStore(dir).listSurfaces("t-1");
        assertEquals(2, surfaces.size(), "same surfaceId overwritten");
        assertTrue(surfaces.stream().anyMatch(s -> s.surfaceId().equals("sales-dashboard")
                && s.content().contains("{}")), "latest content kept");
    }

    @Test
    void deleteThreadAlsoRemovesSurfaces() {
        store.createThread("t-1", null);
        store.saveSurface("t-1", "s1", "{}");
        store.deleteThread("t-1");
        assertTrue(store.listSurfaces("t-1").isEmpty());
    }

    @Test
    void corruptStoreFileStartsEmpty() throws Exception {
        java.nio.file.Files.writeString(dir.resolve("threads.json"), "{not json");
        ChatThreadStore s2 = new ChatThreadStore(dir);
        assertTrue(s2.listThreads().isEmpty());
    }

    @org.junit.jupiter.api.Test
    void branchLifecycle() {
        // P-Q: 分叉建档 → 前缀读取 → 一次性上文注入
        store.createThread("p1", "销售分析");
        var prefix = java.util.List.of(
                java.util.Map.of("id", "u1", "role", "user", "content", "问题1"),
                java.util.Map.of("id", "a1", "role", "assistant", "content", "回答1"));
        var t = store.createBranch("b1", "p1", "销售分析", "u2", prefix);
        assertEquals("b1", t.id());
        assertTrue(t.title().contains("销售分析"), "分叉标题含源会话名: " + t.title());
        assertEquals("p1", t.toJson().path("branchedFrom").path("threadId").asText());
        assertEquals("u2", t.toJson().path("branchedFrom").path("messageId").asText());

        // 前缀可读(供 messages API 合并)
        var fp = store.forkPrefixMessages("b1");
        assertEquals(2, fp.size());
        assertEquals("问题1", fp.get(0).path("content").asText());

        // 上文注入一次性
        String ctx = store.consumeForkContext("b1");
        assertNotNull(ctx);
        assertTrue(ctx.contains("<forked_context>") && ctx.contains("问题1") && ctx.contains("回答1"));
        assertNull(store.consumeForkContext("b1"), "只能注入一次");
        // 普通会话无上文
        assertNull(store.consumeForkContext("p1"));
    }
}
