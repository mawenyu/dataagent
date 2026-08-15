package com.example.gateway.agui;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * workspace 文件管理（spec: docs/spec/workspace-files.md）。
 * 服务层直测（@TempDir 真实文件系统），controller 层直接调用。
 */
class WorkspaceFilesControllerTest {

    @TempDir
    Path dir;

    private WorkspaceFileService files;
    private WorkspaceFilesController controller;

    @BeforeEach
    void setUp() {
        files = new WorkspaceFileService(dir, 1024); // 测试上限 1KB
        controller = new WorkspaceFilesController(files);
    }

    @Test
    void uploadListDownloadDeleteRoundtrip() throws Exception {
        byte[] csv = "区域,销售额\n华北,388082\n".getBytes();
        assertTrue(files.store("q3.csv", csv).isPresent());

        var list = controller.list(null);
        assertEquals(1, list.path("files").size());
        assertEquals("q3.csv", list.path("files").get(0).path("name").asText());
        assertEquals(csv.length, list.path("files").get(0).path("size").asInt());
        assertFalse(list.path("files").get(0).path("modifiedAt").asText().isBlank());

        var dl = controller.download("q3.csv");
        assertTrue(dl.getStatusCode().is2xxSuccessful());
        assertEquals("text/csv;charset=utf-8", dl.getHeaders().getFirst("Content-Type"));
        assertArrayEquals(csv, Files.readAllBytes(dir.resolve("q3.csv")));

        assertTrue(controller.delete("q3.csv").getStatusCode().is2xxSuccessful());
        assertTrue(controller.download("q3.csv").getStatusCode().is4xxClientError());
    }

    @Test
    void pathTraversalAndBadNamesRejected() {
        assertTrue(files.resolve("../etc/passwd").isEmpty());
        assertTrue(files.resolve("..").isEmpty());
        assertTrue(files.resolve("a/b.csv").isEmpty());
        assertTrue(files.resolve("中文.csv").isEmpty());
        assertTrue(files.resolve(".hidden").isEmpty());
        assertTrue(files.resolve("ok-file_1.2.csv").isPresent());

        assertTrue(controller.download("../x").getStatusCode().is4xxClientError());
        assertTrue(controller.delete("ghost.csv").getStatusCode().is4xxClientError());
    }

    @Test
    void uploadSizeLimitEnforced() {
        assertTrue(files.store("big.csv", new byte[2048]).isEmpty(), "over 1KB limit rejected");
        assertTrue(files.store("small.csv", new byte[100]).isPresent());
        assertTrue(files.store("empty.csv", new byte[0]).isEmpty(), "empty rejected");
    }

    // ---- task5-B4: PUT /files/{name} 覆盖写（spec: copilotkit-capabilities.md B4）----

    @Test
    void putCreatesAndOverwrites() throws Exception {
        // 新建：PUT 不要求文件已存在
        var created = controller.put("grid.csv", "a,b\n1,2\n".getBytes());
        assertTrue(created.getStatusCode().is2xxSuccessful());
        assertEquals("grid.csv", created.getBody().path("name").asText());
        assertEquals(8, created.getBody().path("size").asInt());
        assertEquals("a,b\n1,2\n", Files.readString(dir.resolve("grid.csv")));

        // 覆盖：同名校验内容被替换
        var overwritten = controller.put("grid.csv", "a,b\n9,9\n".getBytes());
        assertTrue(overwritten.getStatusCode().is2xxSuccessful());
        assertEquals("a,b\n9,9\n", Files.readString(dir.resolve("grid.csv")));
    }

    @Test
    void putRejectsBadName() {
        assertEquals(400, controller.put("../evil.csv", "x".getBytes()).getStatusCode().value());
        assertEquals(400, controller.put("中文.csv", "x".getBytes()).getStatusCode().value());
        assertFalse(Files.exists(dir.resolve("evil.csv")));
    }

    @Test
    void putEnforcesSizeLimitAndRejectsEmpty() {
        assertEquals(413, controller.put("big.csv", new byte[2048]).getStatusCode().value(), "超 1KB 测试上限 → 413");
        assertEquals(400, controller.put("empty.csv", new byte[0]).getStatusCode().value(), "空 body → 400");
        assertFalse(Files.exists(dir.resolve("big.csv")));
        assertFalse(Files.exists(dir.resolve("empty.csv")));
    }

    @Test
    void listSkipsDirectoriesAndHiddenFiles() throws Exception {
        Files.createDirectories(dir.resolve("subdir"));
        Files.writeString(dir.resolve("a.csv"), "x");
        assertEquals(1, files.list().size());
        assertEquals("a.csv", files.list().get(0).name());
    }

    // ---- task6-A: workspace 会话隔离（spec: docs/spec/workspace-isolation.md）----

    @Test
    void forThreadIsolatesDirectories() throws Exception {
        var t1 = files.forThread("thread-aaa").orElseThrow();
        var t2 = files.forThread("thread-bbb").orElseThrow();
        t1.store("a.csv", "x".getBytes());
        t2.store("b.csv", "y".getBytes());
        assertEquals(1, t1.list().size());
        assertEquals("a.csv", t1.list().get(0).name());
        assertEquals(1, t2.list().size());
        assertEquals("b.csv", t2.list().get(0).name());
        // 物理隔离：各自 threads/<id>/ 下
        assertTrue(Files.exists(dir.resolve("threads/thread-aaa/a.csv")));
        assertTrue(Files.exists(dir.resolve("threads/thread-bbb/b.csv")));
        // 共享根不受影响
        assertEquals(0, files.list().size());
    }

    @Test
    void forThreadRejectsBadThreadIds() {
        assertTrue(files.forThread("..").isEmpty());
        assertTrue(files.forThread("a/b").isEmpty());
        assertTrue(files.forThread("").isEmpty());
        assertTrue(files.forThread(null).isEmpty());
        assertTrue(files.forThread("中文线程").isEmpty());
        assertTrue(files.forThread("ok-thread_1.2").isPresent());
    }

    @Test
    void forThreadSeedsSharedRootFilesOnce() throws Exception {
        // 共享根放示例数据（模拟 workspace/ 下的销售 CSV）
        files.store("sample.csv", "区域,销售额\n华北,1\n".getBytes());
        Files.createDirectories(dir.resolve("threads")); // seed 不应拷贝 threads 目录自身

        var t1 = files.forThread("t-seed").orElseThrow();
        assertEquals("区域,销售额\n华北,1\n",
                Files.readString(dir.resolve("threads/t-seed/sample.csv")),
                "首次创建会话目录时从共享根播种示例文件");

        // 用户删掉示例文件后不会被重复播种复活
        t1.delete("sample.csv");
        var again = files.forThread("t-seed").orElseThrow();
        assertEquals(0, again.list().size(), "目录已存在则不重复播种");
    }

    @Test
    void deleteThreadDirRemovesRecursively() throws Exception {
        var t1 = files.forThread("t-del").orElseThrow();
        t1.store("keep.csv", "x".getBytes());
        assertTrue(Files.exists(dir.resolve("threads/t-del/keep.csv")));
        assertTrue(files.deleteThreadDir("t-del"));
        assertFalse(Files.exists(dir.resolve("threads/t-del")), "目录连同内容删除");
        assertFalse(files.deleteThreadDir("t-del"), "重复删除返回 false");
        assertFalse(files.deleteThreadDir("../etc"), "非法 id 拒绝");
    }

    @Test
    void threadScopedControllerEndpoints() throws Exception {
        var t1 = files.forThread("thread-aaa").orElseThrow();
        t1.store("only-t1.csv", "1".getBytes());

        // GET list 按会话隔离
        var l1 = controller.listThreadFiles("thread-aaa", null);
        assertEquals(1, l1.path("files").size());
        assertEquals("only-t1.csv", l1.path("files").get(0).path("name").asText());
        var l2 = controller.listThreadFiles("thread-bbb", null);
        assertEquals(0, l2.path("files").size(), "另一会话看不到 t1 的文件");

        // GET 下载 / PUT 覆盖写 / DELETE
        assertTrue(controller.downloadThreadFile("thread-aaa", "only-t1.csv").getStatusCode().is2xxSuccessful());
        assertTrue(controller.downloadThreadFile("thread-bbb", "only-t1.csv").getStatusCode().is4xxClientError());
        var put = controller.putThreadFile("thread-aaa", "new.csv", "a,b\n".getBytes(), null);
        assertTrue(put.getStatusCode().is2xxSuccessful());
        assertEquals("a,b\n", Files.readString(dir.resolve("threads/thread-aaa/new.csv")));
        assertTrue(controller.deleteThreadFile("thread-aaa", "new.csv").getStatusCode().is2xxSuccessful());

        // 非法 threadId → 400
        assertFalse(controller.listThreadFiles("..", null).path("error").asText().isBlank(),
                "listThreadFiles 非法 id 返回 error 体");
    }

    @Test
    void threadScopedRejectsBadThreadId() {
        assertTrue(controller.downloadThreadFile("..", "x.csv").getStatusCode().is4xxClientError());
        assertEquals(400, controller.putThreadFile("a/b", "x.csv", "x".getBytes(), null).getStatusCode().value());
        assertTrue(controller.deleteThreadFile("..", "x.csv").getStatusCode().is4xxClientError());
    }

    // ---- P15: PUT 乐观并发冲突检测（baseModified）----

    @Test
    void putWithStaleBaseModifiedGets409() throws Exception {
        var svc = files.forThread("t-conflict").orElseThrow();
        svc.store("g.csv", "a,b\n1,2\n".getBytes());
        long current = Files.getLastModifiedTime(dir.resolve("threads/t-conflict/g.csv")).toMillis();

        // 携带过期 baseModified → 409
        var stale = controller.putThreadFile("t-conflict", "g.csv", "a,b\n9,9\n".getBytes(), current - 10000);
        assertEquals(409, stale.getStatusCode().value());
        assertTrue(stale.getBody().path("error").asText().contains("conflict"));
        // 文件未被覆盖
        assertEquals("a,b\n1,2\n", Files.readString(dir.resolve("threads/t-conflict/g.csv")));

        // 携带当前 baseModified → 200 落盘
        var ok = controller.putThreadFile("t-conflict", "g.csv", "a,b\n9,9\n".getBytes(), current);
        assertEquals(200, ok.getStatusCode().value());
        assertEquals("a,b\n9,9\n", Files.readString(dir.resolve("threads/t-conflict/g.csv")));
    }

    @Test
    void putWithoutBaseModifiedKeepsLegacyBehavior() {
        var svc = files.forThread("t-legacy").orElseThrow();
        svc.store("g.csv", "a,b\n1,2\n".getBytes());
        // 不带 baseModified（null）→ 原覆盖语义
        var res = controller.putThreadFile("t-legacy", "g.csv", "x,y\n".getBytes(), null);
        assertEquals(200, res.getStatusCode().value());
    }

    @Test
    void pnNestedDirectoryBrowse() throws Exception {
        // P-N: 子目录列表/进入/读写删
        Files.createDirectories(dir.resolve("reports/2026"));
        Files.writeString(dir.resolve("reports/2026/q1.csv"), "q,1\n");
        Files.writeString(dir.resolve("reports/readme.md"), "# r\n");
        Files.writeString(dir.resolve("top.csv"), "t,1\n");

        // 根列表: dirs 含 reports,files 只含顶层
        var root = controller.list(null);
        assertEquals(1, root.path("dirs").size());
        assertEquals("reports", root.path("dirs").get(0).asText());
        assertEquals(1, root.path("files").size());
        assertEquals("top.csv", root.path("files").get(0).path("name").asText());

        // 进入子目录
        var sub = controller.list("reports");
        assertEquals(1, sub.path("dirs").size());
        assertEquals("2026", sub.path("dirs").get(0).asText());
        assertEquals("readme.md", sub.path("files").get(0).path("name").asText());

        // 嵌套下载/删除(路径段)
        var dl = controller.download("reports/2026/q1.csv");
        assertTrue(dl.getStatusCode().is2xxSuccessful());
        assertTrue(controller.delete("reports/2026/q1.csv").getStatusCode().is2xxSuccessful());
        assertTrue(controller.download("reports/2026/q1.csv").getStatusCode().is4xxClientError());
    }

    @Test
    void pnNestedTraversalRejected() {
        assertTrue(files.resolvePath("..").isEmpty());
        assertTrue(files.resolvePath("a/../b").isEmpty());
        assertTrue(files.resolvePath("a//b").isEmpty());
        assertTrue(files.resolvePath("中文/ok.csv").isEmpty());
        assertTrue(files.resolvePath("a.b/c-d/e_f.csv").isPresent());
        // 深度上限 8
        assertTrue(files.resolvePath("a/b/c/d/e/f/g/h/i.csv").isEmpty());
        assertTrue(controller.list("../x").path("files").isEmpty());
        assertTrue(controller.download("a/../../etc/passwd").getStatusCode().is4xxClientError());
    }

    @Test
    void pnRootHidesThreadsDir() throws Exception {
        // 共享根的 threads/ 是会话隔离内部目录,目录导航不暴露
        Files.createDirectories(dir.resolve("threads"));
        Files.createDirectories(dir.resolve("public-dir"));
        var root = controller.list(null);
        assertEquals(1, root.path("dirs").size());
        assertEquals("public-dir", root.path("dirs").get(0).asText());
    }

    @Test
    void pnLeadingSlashNormalized() {
        // Spring {*name} 通配捕获带前导斜杠 —— resolvePath 须归一
        assertTrue(files.resolvePath("/a.b/c.csv").isPresent());
        assertTrue(files.resolvePath("/").isPresent());
        assertTrue(files.resolvePath("/../x").isEmpty());
    }
}
