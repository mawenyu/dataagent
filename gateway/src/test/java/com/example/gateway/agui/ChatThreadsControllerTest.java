package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 需求1: /chat/threads REST API（直接用 stub WebClient 驱动，不起服务器）。
 */
class ChatThreadsControllerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path dir;

    private JsonThreadRepository store;
    private AgUiProtocolServiceTest.StubOpenCode stub;
    private ChatThreadsController controller;
    private WorkspaceFileService workspaceFiles;

    @BeforeEach
    void setUp() {
        store = new JsonThreadRepository(dir);
        stub = new AgUiProtocolServiceTest.StubOpenCode();
        workspaceFiles = new WorkspaceFileService(dir.resolve("workspace"), 1024 * 1024);
        controller = new ChatThreadsController(store, new ThreadMessagesService(), stub.client(), workspaceFiles);
    }

    @Test
    void createListRenameDelete() {
        controller.create(Map.of("id", "t1", "title", "销售分析")).block();
        controller.create(Map.of("id", "t2")).block();
        JsonNode list = controller.list().block();
        assertEquals(2, list.path("data").size());
        assertEquals("t2", list.path("data").get(0).path("id").asText(), "newest first");

        assertTrue(controller.rename("t1", Map.of("title", "八月销售")).block().getStatusCode().is2xxSuccessful());
        assertEquals("八月销售", store.getThread("t1").orElseThrow().title());
        assertTrue(controller.rename("ghost", Map.of("title", "x")).block().getStatusCode().is4xxClientError());

        assertTrue(controller.delete("t2").block().getStatusCode().is2xxSuccessful());
        assertEquals(1, controller.list().block().path("data").size());
    }

    @Test
    void messagesFromLiveSessionPlusSurfaces() throws Exception {
        store.createThread("t1", null);
        // 用协议服务跑一轮以绑定 session（stub 创建 ses_stub_1）
        // 这里直接绑：controller 只关心 store 里的映射
        store.bindSession("t1", "ses_stub_1");
        stub.sessionCreates = 1; // 让 stub 认为 ses_stub_1 存在
        stub.sessionHistory.add("""
            {"data":[
              {"id":"a1","type":"assistant","content":[{"type":"text","id":"t","text":"你好！有什么可以帮你？"}]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"你好"}]}
            ]}
            """);
        store.saveSurface("t1", "sales-dashboard", "{\"a2ui_operations\":[{\"createSurface\":{\"surfaceId\":\"sales-dashboard\"}}]}");

        JsonNode res = controller.messages("t1").block(java.time.Duration.ofSeconds(5));
        JsonNode data = res.path("data");
        assertEquals(3, data.size(), "user + assistant + activity surface");
        assertEquals("user", data.get(0).path("role").asText());
        assertEquals("assistant", data.get(1).path("role").asText());
        JsonNode activity = data.get(2);
        assertEquals("activity", activity.path("role").asText());
        assertEquals("a2ui-surface", activity.path("activityType").asText());
        assertEquals("a2ui-sales-dashboard", activity.path("id").asText());
        assertTrue(activity.path("content").path("a2ui_operations").isArray());
    }

    @Test
    void messagesForUnknownOrDeadSessionReturnEmptyList() {
        store.createThread("t-nosession", null);
        JsonNode res = controller.messages("t-nosession").block(java.time.Duration.ofSeconds(5));
        assertEquals(0, res.path("data").size());

        store.createThread("t-dead", null);
        store.bindSession("t-dead", "ses_gone"); // stub 不认识 → 404 → 空列表兜底
        JsonNode res2 = controller.messages("t-dead").block(java.time.Duration.ofSeconds(5));
        assertEquals(0, res2.path("data").size());
    }

    /** task6: 删除会话级联删除其工作目录（spec: docs/spec/workspace-isolation.md）。 */
    @Test
    void deleteThreadCascadesWorkspaceDir() throws Exception {
        controller.create(Map.of("id", "t-ws-del")).block();
        var svc = workspaceFiles.forThread("t-ws-del").orElseThrow();
        svc.store("data.csv", "x".getBytes());
        assertTrue(java.nio.file.Files.exists(
                dir.resolve("workspace/threads/t-ws-del/data.csv")));

        assertTrue(controller.delete("t-ws-del").block().getStatusCode().is2xxSuccessful());
        assertFalse(java.nio.file.Files.exists(dir.resolve("workspace/threads/t-ws-del")),
                "会话目录随会话删除");
    }

    @org.junit.jupiter.api.Test
    void branchCreatesForkWithPrefixAndMessagesMerge() {
        // P-Q: POST /{id}/branch —— 截断分叉点之前的上下文为新会话前缀
        controller.create(Map.of("id", "p1", "title", "销售分析")).block();
        store.bindSession("p1", "ses_x");
        stub.sessionHistory.add("""
            {"data":[
              {"id":"a2","type":"assistant","content":[{"type":"text","text":"回答2"}]},
              {"id":"u2","type":"user","content":[{"type":"text","text":"问题2"}]},
              {"id":"a1","type":"assistant","content":[{"type":"text","text":"回答1"}]},
              {"id":"u1","type":"user","content":[{"type":"text","text":"问题1"}]}
            ]}
            """); // OpenCode 返回最新在前
        var res = controller.branch("p1", Map.of("messageId", "u2", "newThreadId", "b1")).block();
        assertNotNull(res);
        assertTrue(res.getStatusCode().is2xxSuccessful());
        JsonNode data = res.getBody().path("data");
        assertEquals("b1", data.path("id").asText());
        assertTrue(data.path("title").asText().contains("销售分析"));
        assertEquals("p1", data.path("branchedFrom").path("threadId").asText());

        // 分叉会话 messages = 前缀(u2 之前,不含 u2/回答2)
        JsonNode msgs = controller.messages("b1").block();
        var arr = msgs.path("data");
        assertEquals(2, arr.size());
        assertEquals("问题1", arr.get(0).path("content").asText());
        assertEquals("回答1", arr.get(1).path("content").asText());

        // list 带分支来源(侧边栏标记)
        JsonNode list = controller.list().block();
        JsonNode b1Json = null;
        for (JsonNode t : list.path("data")) if ("b1".equals(t.path("id").asText())) b1Json = t;
        assertNotNull(b1Json);
        assertEquals("p1", b1Json.path("branchedFrom").path("threadId").asText());
    }

    @org.junit.jupiter.api.Test
    void branchRejectsUnknownMessageId() {
        controller.create(Map.of("id", "p1")).block();
        store.bindSession("p1", "ses_x");
        stub.sessionHistory.add("{\"data\":[]}");
        var res = controller.branch("p1", Map.of("messageId", "ghost", "newThreadId", "b1")).block();
        assertNotNull(res);
        assertTrue(res.getStatusCode().is4xxClientError());
        assertTrue(store.getThread("b1").isEmpty(), "失败不建档");
    }
}
