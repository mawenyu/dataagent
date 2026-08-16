package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.codec.multipart.FilePart;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P2-9b: 阻塞 IO 不得占用 WebFlux event loop —— controller/service 对
 * {@link ChatThreadStore}（synchronized 单文件 JSON）与
 * {@link WorkspaceFileService}（同步 Files.*）的调用必须发生在
 * boundedElastic 线程上（WebFlux handler 直接调同步方法 = 在
 * reactor-http-nio event loop 上跑磁盘 IO，磁盘抖动会冻结全部 SSE 流）。
 *
 * <p>用记录线程名的 spy 断言执行线程；正确性（synchronized 语义、响应契约）
 * 由既有 ChatThreadsControllerTest / WorkspaceFilesControllerTest /
 * AgUiProtocolServiceTest 锁定。
 */
class BlockingIoOffloadTest {

    @TempDir
    Path dir;

    // ------------------------------------------------------------ spies ---

    static final class RecordingStore extends ChatThreadStore {
        final Map<String, String> calls = new ConcurrentHashMap<>();

        RecordingStore(Path dir) { super(dir); }

        private void rec(String m) { calls.put(m, Thread.currentThread().getName()); }

        @Override public synchronized ChatThread createThread(String id, String title) {
            rec("createThread"); return super.createThread(id, title);
        }

        @Override public synchronized List<ChatThread> listThreads() {
            rec("listThreads"); return super.listThreads();
        }

        @Override public synchronized Optional<ChatThread> getThread(String id) {
            rec("getThread"); return super.getThread(id);
        }

        @Override public synchronized void renameThread(String id, String title) {
            rec("renameThread"); super.renameThread(id, title);
        }

        @Override public synchronized void deleteThread(String id) {
            rec("deleteThread"); super.deleteThread(id);
        }

        @Override public synchronized void touch(String id) {
            rec("touch"); super.touch(id);
        }

        @Override public synchronized void setTitleFromFirstMessage(String id, String msg) {
            rec("setTitleFromFirstMessage"); super.setTitleFromFirstMessage(id, msg);
        }

        @Override public synchronized String resolveSession(String threadId) {
            rec("resolveSession"); return super.resolveSession(threadId);
        }

        @Override public synchronized void bindSession(String threadId, String sessionId) {
            rec("bindSession"); super.bindSession(threadId, sessionId);
        }

        @Override public synchronized List<JsonNode> forkPrefixMessages(String id) {
            rec("forkPrefixMessages"); return super.forkPrefixMessages(id);
        }

        @Override public synchronized List<SurfaceRecord> listSurfaces(String threadId) {
            rec("listSurfaces"); return super.listSurfaces(threadId);
        }

        @Override public synchronized void saveSurface(String threadId, String surfaceId, String content) {
            rec("saveSurface"); super.saveSurface(threadId, surfaceId, content);
        }

        @Override public synchronized ChatThread createBranch(String newId, String parentId, String parentTitle,
                                                              String messageId, List<Map<String, String>> prefix) {
            rec("createBranch"); return super.createBranch(newId, parentId, parentTitle, messageId, prefix);
        }
    }

    static final class RecordingWorkspace extends WorkspaceFileService {
        final Map<String, String> calls = new ConcurrentHashMap<>();

        RecordingWorkspace(Path root, long maxUploadBytes) { super(root, maxUploadBytes); }

        private void rec(String m) { calls.put(m, Thread.currentThread().getName()); }

        @Override public DirListing listDir(String rel) {
            rec("listDir"); return super.listDir(rel);
        }

        @Override public Optional<org.springframework.core.io.Resource> read(String name) {
            rec("read"); return super.read(name);
        }

        @Override public Optional<FileInfo> store(String name, byte[] content) {
            rec("store"); return super.store(name, content);
        }

        @Override public boolean delete(String name) {
            rec("delete"); return super.delete(name);
        }

        @Override public Optional<WorkspaceFileService> forThread(String threadId) {
            rec("forThread"); return super.forThread(threadId);
        }

        @Override public boolean deleteThreadDir(String threadId) {
            rec("deleteThreadDir"); return super.deleteThreadDir(threadId);
        }
    }

    static final class RecordingMetrics extends RunMetricsService {
        final Map<String, String> calls = new ConcurrentHashMap<>();

        RecordingMetrics(Path file) { super(file); }

        private void rec(String m) { calls.put(m, Thread.currentThread().getName()); }

        @Override public void runStarted(String runId, String threadId) {
            rec("runStarted"); super.runStarted(runId, threadId);
        }

        @Override public void runFinished(String runId, String threadId, String outcome) {
            rec("runFinished"); super.runFinished(runId, threadId, outcome);
        }
    }

    /** 最小 FilePart stub（内存 buffer 上传）。 */
    static FilePart filePart(String filename, byte[] content) {
        return new FilePart() {
            @Override public String filename() { return filename; }
            @Override public String name() { return "file"; }
            @Override public HttpHeaders headers() { return new HttpHeaders(); }
            @Override public Flux<DataBuffer> content() {
                return Flux.just(new DefaultDataBufferFactory().wrap(content));
            }
            @Override public Mono<Void> transferTo(Path dest) { return Mono.empty(); }
            @Override public Mono<Void> delete() { return Mono.empty(); }
        };
    }

    private static void assertOffloaded(Map<String, String> calls, String... methods) {
        for (String m : methods) {
            String t = calls.get(m);
            assertNotNull(t, m + " 应被调用");
            assertTrue(t.contains("boundedElastic"),
                    m + " 必须在 boundedElastic 上执行（阻塞 IO 不得上 event loop），实际线程: " + t);
        }
    }

    private RecordingStore store;
    private RecordingWorkspace workspace;
    private AgUiProtocolServiceTest.StubOpenCode stub;

    @BeforeEach
    void setUp() {
        store = new RecordingStore(dir.resolve("threads"));
        workspace = new RecordingWorkspace(dir.resolve("ws"), 1024 * 1024);
        stub = new AgUiProtocolServiceTest.StubOpenCode();
    }

    // ------------------------------------------------------------ tests ---

    @Test
    void chatThreadsCrudOffloadsStoreAndWorkspaceIo() {
        var controller = new ChatThreadsController(store, new ThreadMessagesService(), stub.client(), workspace);
        controller.create(Map.of("id", "t1", "title", "x")).block(Duration.ofSeconds(5));
        controller.list().block(Duration.ofSeconds(5));
        controller.rename("t1", Map.of("title", "y")).block(Duration.ofSeconds(5));
        controller.delete("t1").block(Duration.ofSeconds(5));

        assertOffloaded(store.calls, "createThread", "listThreads", "getThread", "renameThread", "deleteThread");
        assertOffloaded(workspace.calls, "deleteThreadDir");
    }

    @Test
    void chatThreadsMessagesAndBranchOffloadStoreIo() {
        var controller = new ChatThreadsController(store, new ThreadMessagesService(), stub.client(), workspace);
        store.createThread("t1", null);
        store.bindSession("t1", "ses_stub_1");
        stub.sessionCreates = 1;
        stub.sessionHistory.add("""
            {"data":[{"id":"u1","type":"user","content":[{"type":"text","text":"问题1"}]}]}
            """);
        store.calls.clear();

        controller.messages("t1").block(Duration.ofSeconds(5));
        assertOffloaded(store.calls, "resolveSession", "listSurfaces", "forkPrefixMessages");

        store.calls.clear();
        stub.sessionHistory.add("""
            {"data":[{"id":"u1","type":"user","content":[{"type":"text","text":"问题1"}]}]}
            """);
        controller.branch("t1", Map.of("messageId", "u1", "newThreadId", "b1")).block(Duration.ofSeconds(5));
        assertOffloaded(store.calls, "getThread", "forkPrefixMessages", "resolveSession", "createBranch");
    }

    @Test
    void workspaceFilesEndpointsOffloadFileIo() {
        var controller = new WorkspaceFilesController(workspace);
        controller.put("a.csv", "x".getBytes()).block(Duration.ofSeconds(5));
        controller.list(null).block(Duration.ofSeconds(5));
        controller.download("a.csv").block(Duration.ofSeconds(5));
        controller.delete("a.csv").block(Duration.ofSeconds(5));

        assertOffloaded(workspace.calls, "store", "listDir", "read", "delete");
    }

    @Test
    void workspaceUploadOffloadsFileIo() {
        var controller = new WorkspaceFilesController(workspace);
        var res = controller.upload(filePart("up.csv", "a,b\n".getBytes()), null).block(Duration.ofSeconds(5));
        assertNotNull(res);
        assertTrue(res.getStatusCode().is2xxSuccessful(), "上传行为不变");
        assertOffloaded(workspace.calls, "store");
    }

    @Test
    void threadScopedFileEndpointsOffloadForThreadIo() {
        var controller = new WorkspaceFilesController(workspace);
        controller.listThreadFiles("t-iso", null).block(Duration.ofSeconds(5));
        assertOffloaded(workspace.calls, "forThread");
    }

    @Test
    void agentRunOffloadsThreadStoreWorkspaceAndMetricsIo() {
        RecordingMetrics metrics = new RecordingMetrics(dir.resolve("metrics.log"));
        A2UiSurfaceRegistry surfaceRegistry = new A2UiSurfaceRegistry();
        A2UiService a2UiService = new A2UiService();
        A2UiBridgeService bridge = new A2UiBridgeService(a2UiService, surfaceRegistry);
        FrontendToolBridge toolBridge = new FrontendToolBridge();
        AguiEventTranslator translator = new AguiEventTranslator(toolBridge, bridge);
        var service = new AgUiProtocolService(stub.client(), translator, toolBridge,
                bridge, new A2UiActionHandler(), new AllowAllThreadAccessPolicy(),
                AgUiProtocolService.DEFAULT_RUN_IDLE_TIMEOUT, "ws-data",
                AgUiProtocolService.DEFAULT_MODEL_ID, AgUiProtocolService.DEFAULT_PROVIDER_ID,
                store, workspace, metrics,
                new HitlConfirmHandler(a2UiService, surfaceRegistry, metrics));

        // render_a2ui 事件流 → ACTIVITY_SNAPSHOT → saveSurface + metrics 收尾
        String stream =
                "data: {\"type\":\"session.tool.input.started\",\"data\":{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"name\":\"render_a2ui\"}}\n\n"
                + "data: {\"type\":\"session.tool.input.ended\",\"data\":{\"assistantMessageID\":\"m1\",\"id\":\"c1\"}}\n\n"
                + "data: {\"type\":\"session.tool.called\",\"data\":{\"assistantMessageID\":\"m1\",\"id\":\"c1\",\"input\":{"
                + "\"surfaceId\":\"sales-card\",\"components\":["
                + "{\"component\":\"MetricCard\",\"id\":\"root\",\"title\":\"t\",\"value\":\"1\"}]}}}\n\n"
                + "data: {\"type\":\"session.step.ended\",\"data\":{}}\n\n";
        stub.eventStreams.add(stream);

        var input = new RunAgentInput("t-run", "run-1", null,
                List.of(Map.of("role", "user", "content", "渲染看板")), null, null, null);
        var events = service.run(input, "tester").collectList().block(Duration.ofSeconds(10));
        assertNotNull(events);
        assertTrue(events.stream().anyMatch(e -> e.data() != null && e.data().contains("RUN_FINISHED")),
                "run 行为不变（RUN_FINISHED 收尾）");

        assertOffloaded(store.calls, "getThread", "createThread", "setTitleFromFirstMessage", "touch",
                "bindSession", "saveSurface");
        assertOffloaded(workspace.calls, "forThread");
        assertOffloaded(metrics.calls, "runStarted", "runFinished");
    }
}
