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

        var list = controller.list();
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

    @Test
    void listSkipsDirectoriesAndHiddenFiles() throws Exception {
        Files.createDirectories(dir.resolve("subdir"));
        Files.writeString(dir.resolve("a.csv"), "x");
        assertEquals(1, files.list().size());
        assertEquals("a.csv", files.list().get(0).name());
    }
}
