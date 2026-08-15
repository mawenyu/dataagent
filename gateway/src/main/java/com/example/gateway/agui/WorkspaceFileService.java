package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Workspace 文件管理（spec: docs/spec/workspace-files.md）。
 *
 * <p>安全边界：
 * <ul>
 *   <li>文件名白名单 {@code [A-Za-z0-9._-]}（拒绝路径分隔符/中文/../隐藏文件）</li>
 *   <li>解析后 canonical 路径必须位于 workspace 根内（双保险）</li>
 *   <li>上传大小上限（agui.files.max-upload-size，默认 5MB）</li>
 *   <li>只操作顶层普通文件，不递归</li>
 * </ul>
 */
@Service
public class WorkspaceFileService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceFileService.class);
    private static final Pattern NAME_PATTERN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    public record FileInfo(String name, long size, Instant modifiedAt) {}

    private final Path root;
    private final long maxUploadBytes;

    @org.springframework.beans.factory.annotation.Autowired
    public WorkspaceFileService(
            @org.springframework.beans.factory.annotation.Value("${agui.data-workspace:workspace}") String workspace,
            @org.springframework.beans.factory.annotation.Value("${agui.files.max-upload-size:5MB}") org.springframework.util.unit.DataSize maxUpload) {
        this(Path.of(workspace).toAbsolutePath().normalize(), maxUpload.toBytes());
    }

    /** 测试用。 */
    public WorkspaceFileService(Path root, long maxUploadBytes) {
        this.root = root.toAbsolutePath().normalize();
        this.maxUploadBytes = maxUploadBytes;
        try {
            Files.createDirectories(this.root);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** 校验文件名并解析为根内路径；非法返回 empty。 */
    public Optional<Path> resolve(String name) {
        if (name == null || !NAME_PATTERN.matcher(name).matches() || name.contains("..")) {
            return Optional.empty();
        }
        Path p = root.resolve(name).normalize();
        if (!p.startsWith(root) || !p.getParent().equals(root)) return Optional.empty();
        return Optional.of(p);
    }

    public List<FileInfo> list() {
        try (var stream = Files.list(root)) {
            return stream.filter(Files::isRegularFile)
                    .map(p -> {
                        try {
                            return new FileInfo(p.getFileName().toString(), Files.size(p),
                                    Files.getLastModifiedTime(p).toInstant());
                        } catch (IOException e) {
                            return null;
                        }
                    })
                    .filter(f -> f != null && NAME_PATTERN.matcher(f.name()).matches())
                    .sorted(Comparator.comparing(FileInfo::name))
                    .toList();
        } catch (IOException e) {
            log.warn("list workspace files failed: {}", e.getMessage());
            return List.of();
        }
    }

    public Optional<Resource> read(String name) {
        return resolve(name).filter(Files::isRegularFile).map(FileSystemResource::new);
    }

    public Optional<Long> sizeOf(String name) {
        return resolve(name).filter(Files::isRegularFile).map(p -> {
            try {
                return Files.size(p);
            } catch (IOException e) {
                return null;
            }
        });
    }

    /** 上传（覆盖同名）。返回写入字节数；非法名/超限/写失败 → empty。 */
    public Optional<FileInfo> store(String name, byte[] content) {
        if (content == null || content.length == 0) return Optional.empty();
        if (content.length > maxUploadBytes) {
            log.warn("upload rejected: {} bytes > limit {}", content.length, maxUploadBytes);
            return Optional.empty();
        }
        return resolve(name).flatMap(p -> {
            try {
                Files.write(p, content);
                return Optional.of(new FileInfo(name, content.length, Files.getLastModifiedTime(p).toInstant()));
            } catch (IOException e) {
                log.warn("store {} failed: {}", name, e.getMessage());
                return Optional.empty();
            }
        });
    }

    public boolean delete(String name) {
        return resolve(name).filter(Files::isRegularFile).map(p -> {
            try {
                Files.delete(p);
                return true;
            } catch (IOException e) {
                log.warn("delete {} failed: {}", name, e.getMessage());
                return false;
            }
        }).orElse(false);
    }

    public long maxUploadBytes() {
        return maxUploadBytes;
    }
}
