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

    private ChatThreadStore store;
    private AgUiProtocolServiceTest.StubOpenCode stub;
    private ChatThreadsController controller;

    @BeforeEach
    void setUp() {
        store = new ChatThreadStore(dir);
        stub = new AgUiProtocolServiceTest.StubOpenCode();
        controller = new ChatThreadsController(store, new ThreadMessagesService(), stub.client());
    }

    @Test
    void createListRenameDelete() {
        controller.create(Map.of("id", "t1", "title", "销售分析"));
        controller.create(Map.of("id", "t2"));
        JsonNode list = controller.list();
        assertEquals(2, list.path("data").size());
        assertEquals("t2", list.path("data").get(0).path("id").asText(), "newest first");

        assertTrue(controller.rename("t1", Map.of("title", "八月销售")).getStatusCode().is2xxSuccessful());
        assertEquals("八月销售", store.getThread("t1").orElseThrow().title());
        assertTrue(controller.rename("ghost", Map.of("title", "x")).getStatusCode().is4xxClientError());

        assertTrue(controller.delete("t2").getStatusCode().is2xxSuccessful());
        assertEquals(1, controller.list().path("data").size());
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
}
