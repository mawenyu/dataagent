package com.example.gateway.agui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.core.io.Resource;
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

    /** GET /files — 列出 workspace 文件。 */
    @GetMapping("/files")
    public ObjectNode list() {
        ObjectNode out = MAPPER.createObjectNode();
        var arr = out.putArray("files");
        for (WorkspaceFileService.FileInfo f : files.list()) {
            ObjectNode n = arr.addObject();
            n.put("name", f.name());
            n.put("size", f.size());
            n.put("modifiedAt", f.modifiedAt().toString());
        }
        return out;
    }

    /** GET /files/{name} — 下载/查看内容。 */
    @GetMapping("/files/{name}")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        return files.read(name)
                .map(res -> {
                    String contentType = guessContentType(name);
                    return ResponseEntity.ok()
                            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                            .contentType(MediaType.parseMediaType(contentType))
                            .body(res);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /** POST /files — 上传（multipart，字段名 file）。 */
    @PostMapping(value = "/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<ResponseEntity<ObjectNode>> upload(@RequestPart("file") FilePart file) {
        String name = file.filename();
        if (files.resolve(name).isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().body(err("invalid file name")));
        }
        return DataBufferUtils.join(file.content())
                .map(buf -> {
                    byte[] bytes = new byte[buf.readableByteCount()];
                    buf.read(bytes);
                    DataBufferUtils.release(buf);
                    return bytes;
                })
                .map(bytes -> {
                    if (bytes.length > files.maxUploadBytes()) {
                        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
                    }
                    return files.store(name, bytes)
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
    @PutMapping(value = "/files/{name}", consumes = {MediaType.TEXT_PLAIN_VALUE, MediaType.ALL_VALUE})
    public ResponseEntity<ObjectNode> put(@PathVariable String name, @RequestBody(required = false) byte[] body) {
        if (files.resolve(name).isEmpty()) {
            return ResponseEntity.badRequest().body(err("invalid file name"));
        }
        if (body == null || body.length == 0) {
            return ResponseEntity.badRequest().body(err("empty file"));
        }
        if (body.length > files.maxUploadBytes()) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
        }
        return files.store(name, body)
                .map(info -> {
                    ObjectNode ok = MAPPER.createObjectNode();
                    ok.put("name", info.name());
                    ok.put("size", info.size());
                    return ResponseEntity.ok(ok);
                })
                .orElse(ResponseEntity.badRequest().body(err("store failed")));
    }

    /** DELETE /files/{name} — 删除。 */
    @DeleteMapping("/files/{name}")
    public ResponseEntity<Void> delete(@PathVariable String name) {
        if (files.resolve(name).isEmpty()) return ResponseEntity.badRequest().build();
        return files.delete(name) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    // ==================== task6: 会话级文件 API（workspace 会话隔离） ====================
    // spec: docs/spec/workspace-isolation.md —— /chat/threads/{threadId}/files

    /** GET /chat/threads/{threadId}/files — 列出该会话的文件。 */
    @GetMapping("/chat/threads/{threadId}/files")
    public ObjectNode listThreadFiles(@PathVariable String threadId) {
        return files.forThread(threadId)
                .map(svc -> {
                    ObjectNode out = MAPPER.createObjectNode();
                    var arr = out.putArray("files");
                    for (WorkspaceFileService.FileInfo f : svc.list()) {
                        ObjectNode n = arr.addObject();
                        n.put("name", f.name());
                        n.put("size", f.size());
                        n.put("modifiedAt", f.modifiedAt().toString());
                    }
                    return out;
                })
                .orElseGet(() -> err("invalid threadId"));
    }

    /** GET /chat/threads/{threadId}/files/{name} — 下载/查看。 */
    @GetMapping("/chat/threads/{threadId}/files/{name}")
    public ResponseEntity<Resource> downloadThreadFile(@PathVariable String threadId, @PathVariable String name) {
        return files.forThread(threadId)
                .flatMap(svc -> svc.read(name))
                .map(res -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                        .contentType(MediaType.parseMediaType(guessContentType(name)))
                        .body(res))
                .orElse(ResponseEntity.notFound().build());
    }

    /** POST /chat/threads/{threadId}/files — 上传（multipart，字段名 file）。 */
    @PostMapping(value = "/chat/threads/{threadId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<ResponseEntity<ObjectNode>> uploadThreadFile(@PathVariable String threadId,
                                                             @RequestPart("file") FilePart file) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().body(err("invalid threadId")));
        }
        String name = file.filename();
        if (svc.get().resolve(name).isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().body(err("invalid file name")));
        }
        return DataBufferUtils.join(file.content())
                .map(buf -> {
                    byte[] bytes = new byte[buf.readableByteCount()];
                    buf.read(bytes);
                    DataBufferUtils.release(buf);
                    return bytes;
                })
                .map(bytes -> {
                    if (bytes.length > svc.get().maxUploadBytes()) {
                        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
                    }
                    return svc.get().store(name, bytes)
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

    /** PUT /chat/threads/{threadId}/files/{name} — 文本 body 覆盖写。 */
    @PutMapping(value = "/chat/threads/{threadId}/files/{name}",
            consumes = {MediaType.TEXT_PLAIN_VALUE, MediaType.ALL_VALUE})
    public ResponseEntity<ObjectNode> putThreadFile(@PathVariable String threadId, @PathVariable String name,
                                                    @RequestBody(required = false) byte[] body) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty()) return ResponseEntity.badRequest().body(err("invalid threadId"));
        if (svc.get().resolve(name).isEmpty()) return ResponseEntity.badRequest().body(err("invalid file name"));
        if (body == null || body.length == 0) return ResponseEntity.badRequest().body(err("empty file"));
        if (body.length > svc.get().maxUploadBytes()) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(err("file too large"));
        }
        return svc.get().store(name, body)
                .map(info -> {
                    ObjectNode ok = MAPPER.createObjectNode();
                    ok.put("name", info.name());
                    ok.put("size", info.size());
                    return ResponseEntity.ok(ok);
                })
                .orElse(ResponseEntity.badRequest().body(err("store failed")));
    }

    /** DELETE /chat/threads/{threadId}/files/{name} — 删除。 */
    @DeleteMapping("/chat/threads/{threadId}/files/{name}")
    public ResponseEntity<Void> deleteThreadFile(@PathVariable String threadId, @PathVariable String name) {
        var svc = files.forThread(threadId);
        if (svc.isEmpty() || svc.get().resolve(name).isEmpty()) return ResponseEntity.badRequest().build();
        return svc.get().delete(name) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
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
