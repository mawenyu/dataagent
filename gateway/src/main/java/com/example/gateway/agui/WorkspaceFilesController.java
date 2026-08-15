package com.example.gateway.agui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.core.io.Resource;
import java.nio.file.Files;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import org.springframework.core.io.buffer.DataBufferUtils;

/**
 * Workspace 文件 REST API（spec: docs/spec/workspace-files.md）。
 * 语义化命名 /files，不带实现组件名。
 */
@RestController
public class WorkspaceFilesController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final WorkspaceFileService files;

    public WorkspaceFilesController(WorkspaceFileService files) {
        this.files = files;
    }

    /** GET /files[?path=sub/dir] — 列出目录内容(P-N: dirs + files;path 缺省为根)。 */
    @GetMapping("/files")
    public ObjectNode list(@RequestParam(required = false) String path) {
        return listingJson(files, path);
    }

    /** P-N: DirListing → JSON(dirs 字符串数组 + files 对象数组 + path 回显)。 */
    private ObjectNode listingJson(WorkspaceFileService svc, String path) {
        String rel = path == null ? "" : path;
        var listing = svc.listDir(rel);
        ObjectNode out = MAPPER.createObjectNode();
        out.put("path", rel);
        var dirs = out.putArray("dirs");
        for (String d : listing.dirs()) dirs.add(d);
        var arr = out.putArray("files");
        for (WorkspaceFileService.FileInfo f : listing.files()) {
            ObjectNode n = arr.addObject();
            n.put("name", f.name());
            n.put("size", f.size());
            n.put("modifiedAt", f.modifiedAt().toString());
        }
        return out;
    }

    /** GET /files/{*name} — 下载/查看内容(P-N: 支持子目录相对路径)。 */
    @GetMapping("/files/{*name}")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        return downloadImpl(files, name);
    }

    /** 下载共享实现：200 带 Content-Disposition / 猜测 Content-Type；不存在 404。 */
    private ResponseEntity<Resource> downloadImpl(WorkspaceFileService svc, String name) {
        return svc.read(name)
                .map(res -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                        .contentType(MediaType.parseMediaType(guessContentType(name)))
                        .body(res))
                .orElse(ResponseEntity.notFound().build());
    }

    /** POST /files[?path=sub/dir] — 上传（multipart，字段名 file;P-N: 可入子目录,目录须已存在）。 */
    @PostMapping(value = "/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<ResponseEntity<ObjectNode>> upload(@RequestPart("file") FilePart file,
                                                   @RequestParam(required = false) String path) {
        return uploadImpl(files, file, path);
    }

    /**
     * 上传共享实现：文件名/路径白名单 400、超限 413、空文件 400，
     * 成功 200 {name,size}（P-N: 可入子目录,目录须已存在）。
     */
    private Mono<ResponseEntity<ObjectNode>> uploadImpl(WorkspaceFileService svc, FilePart file, String path) {
        String name = file.filename();
        final String rel = (path == null || path.isBlank()) ? name : path + "/" + name;
        if (svc.resolve(name).isEmpty() || svc.resolvePath(rel).isEmpty()
                || (path != null && !path.isBlank() && !svc.resolvePath(path).filter(Files::isDirectory).isPresent())) {
            return Mono.just(ResponseEntity.badRequest().body(err("invalid file name or path")));
        }
        return DataBufferUtils.join(file.content())
                .map(buf -> {
                    byte[] bytes = new byte[buf.readableByteCount()];
                    buf.read(bytes);
                    DataBufferUtils.release(buf);
                    return bytes;
                })
                .map(bytes -> {
                    if (bytes.length > svc.maxUploadBytes()) {
                        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
                    }
                    return svc.store(rel, bytes)
                            .map(info -> {
                                ObjectNode ok = MAPPER.createObjectNode();
                                ok.put("name", info.name());
                                ok.put("size", info.size());
                                return ResponseEntity.ok(ok);
                            })
                            .orElse(ResponseEntity.badRequest().body(err("empty file or store failed")));
                })
                .defaultIfEmpty(ResponseEntity.badRequest().body(err("empty file")));
    }

    /**
     * PUT /files/{name} — 文本 body 覆盖写（task5-B4 spreadsheet 编辑器保存通道）。
     * 复用 POST 同款防护：文件名白名单 / 大小上限 / 空内容拒绝；文件不存在时新建。
     */
    @PutMapping(value = "/files/{*name}", consumes = {MediaType.TEXT_PLAIN_VALUE, MediaType.ALL_VALUE})
    public ResponseEntity<ObjectNode> put(@PathVariable String name, @RequestBody(required = false) byte[] body) {
        return putImpl(files, name, body, null, false);
    }

    /**
     * PUT 共享实现：非法名 400 / 空 400 / 超限 413 / baseModified 乐观并发不符 409；
     * 成功 200 {name,size[,modifiedAt]}（modifiedAt 仅会话级端点回显，保持既有响应契约）。
     */
    private ResponseEntity<ObjectNode> putImpl(WorkspaceFileService svc, String name, byte[] body,
                                               Long baseModified, boolean includeModifiedAt) {
        if (svc.resolvePath(name).isEmpty()) {
            return ResponseEntity.badRequest().body(err("invalid file name"));
        }
        if (body == null || body.length == 0) {
            return ResponseEntity.badRequest().body(err("empty file"));
        }
        if (body.length > svc.maxUploadBytes()) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
        }
        if (baseModified != null) {
            long actual = svc.resolvePath(name)
                    .filter(Files::isRegularFile)
                    .map(p -> {
                        try {
                            return Files.getLastModifiedTime(p).toMillis();
                        } catch (java.io.IOException e) {
                            return -1L;
                        }
                    })
                    .orElse(-1L);
            if (actual == -1L || actual != baseModified) {
                ObjectNode conflict = err("conflict");
                conflict.put("message", "file modified since read (baseModified mismatch)");
                conflict.put("currentModified", actual);
                return ResponseEntity.status(HttpStatus.CONFLICT).body(conflict);
            }
        }
        return svc.store(name, body)
                .map(info -> {
                    ObjectNode ok = MAPPER.createObjectNode();
                    ok.put("name", info.name());
                    ok.put("size", info.size());
                    if (includeModifiedAt) ok.put("modifiedAt", info.modifiedAt().toString());
                    return ResponseEntity.ok(ok);
                })
                .orElse(ResponseEntity.badRequest().body(err("store failed")));
    }

    /** DELETE /files/{*name} — 删除(P-N: 支持子目录相对路径)。 */
    @DeleteMapping("/files/{*name}")
    public ResponseEntity<Void> delete(@PathVariable String name) {
        return deleteImpl(files, name);
    }

    /** 删除共享实现：非法路径 400；成功 204 / 不存在 404。 */
    private ResponseEntity<Void> deleteImpl(WorkspaceFileService svc, String name) {
        if (svc.resolvePath(name).isEmpty()) return ResponseEntity.badRequest().build();
        return svc.delete(name) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    // ==================== task6: 会话级文件 API（workspace 会话隔离） ====================
    // spec: docs/spec/workspace-isolation.md —— /chat/threads/{threadId}/files

    /** GET /chat/threads/{threadId}/files[?path=sub/dir] — 列出该会话目录内容(P-N: dirs+files)。 */
    @GetMapping("/chat/threads/{threadId}/files")
    public ObjectNode listThreadFiles(@PathVariable String threadId,
                                      @RequestParam(required = false) String path) {
        return files.forThread(threadId)
                .map(svc -> listingJson(svc, path))
                .orElseGet(() -> err("invalid threadId"));
    }

    /** GET /chat/threads/{threadId}/files/{*name} — 下载/查看(P-N: 支持子目录)。 */
    @GetMapping("/chat/threads/{threadId}/files/{*name}")
    public ResponseEntity<Resource> downloadThreadFile(@PathVariable String threadId, @PathVariable String name) {
        return files.forThread(threadId)
                .map(svc -> downloadImpl(svc, name))
                .orElse(ResponseEntity.notFound().build());
    }

    /** POST /chat/threads/{threadId}/files — 上传（multipart，字段名 file）。 */
    @PostMapping(value = "/chat/threads/{threadId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<ResponseEntity<ObjectNode>> uploadThreadFile(@PathVariable String threadId,
                                                             @RequestPart("file") FilePart file,
                                                             @RequestParam(required = false) String path) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().body(err("invalid threadId")));
        }
        return uploadImpl(svc.get(), file, path);
    }

    /**
     * PUT /chat/threads/{threadId}/files/{name} — 文本 body 覆盖写。
     * P15: 可选 baseModified（文件当前 modifiedAt 毫秒）乐观并发检测 ——
     * 与服务端实际 mtime 不符 → 409 conflict，不覆盖（表格编辑器/agent
     * 编辑在读取后被第三方改动时防止静默丢改）。
     */
    @PutMapping(value = "/chat/threads/{threadId}/files/{*name}",
            consumes = {MediaType.TEXT_PLAIN_VALUE, MediaType.ALL_VALUE})
    public ResponseEntity<ObjectNode> putThreadFile(@PathVariable String threadId, @PathVariable String name,
                                                    @RequestBody(required = false) byte[] body,
                                                    @org.springframework.web.bind.annotation.RequestParam(required = false)
                                                    Long baseModified) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty()) return ResponseEntity.badRequest().body(err("invalid threadId"));
        return putImpl(svc.get(), name, body, baseModified, true);
    }

    /** DELETE /chat/threads/{threadId}/files/{*name} — 删除(P-N: 支持子目录)。 */
    @DeleteMapping("/chat/threads/{threadId}/files/{*name}")
    public ResponseEntity<Void> deleteThreadFile(@PathVariable String threadId, @PathVariable String name) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty()) return ResponseEntity.badRequest().build();
        return deleteImpl(svc.get(), name);
    }

    private static ObjectNode err(String msg) {
        ObjectNode n = MAPPER.createObjectNode();
        n.put("error", msg);
        return n;
    }

    private static String guessContentType(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
        if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }
}
