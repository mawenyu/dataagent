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
    /** task6: threadId 白名单（与 run 校验一致）；显式排除 "." / ".." / 含 ".." 片段。 */
    private static final Pattern THREAD_PATTERN = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    /** 会话隔离目录在共享根下的子目录名。 */
    static final String THREADS_DIR = "threads";

    public record FileInfo(String name, long size, Instant modifiedAt) {}

    private final Path root;
    private final long maxUploadBytes;
    /** 共享根（seed 源）；会话级实例此字段为 null（不再向下嵌套）。 */
    private final Path sharedRoot;

    @org.springframework.beans.factory.annotation.Autowired
    public WorkspaceFileService(
            @org.springframework.beans.factory.annotation.Value("${agui.data-workspace:workspace}") String workspace,
            @org.springframework.beans.factory.annotation.Value("${agui.files.max-upload-size:5MB}") org.springframework.util.unit.DataSize maxUpload) {
        this(Path.of(workspace).toAbsolutePath().normalize(), maxUpload.toBytes());
    }

    /** 测试用。 */
    public WorkspaceFileService(Path root, long maxUploadBytes) {
        this(root, maxUploadBytes, root);
    }

    private WorkspaceFileService(Path root, long maxUploadBytes, Path sharedRoot) {
        this.root = root.toAbsolutePath().normalize();
        this.maxUploadBytes = maxUploadBytes;
        this.sharedRoot = sharedRoot == null ? null : sharedRoot.toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.root);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ---------------------------------------------------- task6: 会话隔离 ---

    /** threadId 是否合法（白名单 + 排除路径穿越形态）。 */
    public static boolean isValidThreadId(String threadId) {
        return threadId != null
                && THREAD_PATTERN.matcher(threadId).matches()
                && !threadId.contains("..")
                && !threadId.equals(".");
    }

    /**
     * 会话级文件服务：root = 共享根/threads/{threadId}。非法 id → empty。
     *
     * <p>首次创建会话目录时从共享根播种示例文件（普通文件、一层、不递归），
     * 保证新会话"分析本月销售"开箱可用；目录已存在则不重复播种（用户删除
     * 示例文件后不会复活）。
     */
    public Optional<WorkspaceFileService> forThread(String threadId) {
        if (!isValidThreadId(threadId)) return Optional.empty();
        Path threadRoot = root.resolve(THREADS_DIR).resolve(threadId).normalize();
        if (!threadRoot.startsWith(root)) return Optional.empty();
        boolean fresh = !Files.isDirectory(threadRoot);
        WorkspaceFileService svc = new WorkspaceFileService(threadRoot, maxUploadBytes, null);
        if (fresh) seedThreadDir(threadRoot);
        return Optional.of(svc);
    }

    /** 共享根的普通文件（NAME_PATTERN 白名单）拷入新会话目录；失败仅记日志。 */
    private void seedThreadDir(Path threadRoot) {
        Path seedSource = sharedRoot != null ? sharedRoot : root;
        try (var stream = Files.list(seedSource)) {
            stream.filter(Files::isRegularFile)
                    .filter(p -> NAME_PATTERN.matcher(p.getFileName().toString()).matches())
                    .forEach(p -> {
                        try {
                            Files.copy(p, threadRoot.resolve(p.getFileName().toString()));
                        } catch (IOException e) {
                            log.warn("seed {} -> {} failed: {}", p.getFileName(), threadRoot, e.getMessage());
                        }
                    });
        } catch (IOException e) {
            log.warn("seed thread dir {} failed: {}", threadRoot, e.getMessage());
        }
    }

    /** 删除会话工作目录（递归）。id 非法或目录不存在 → false。 */
    public boolean deleteThreadDir(String threadId) {
        if (!isValidThreadId(threadId)) return false;
        Path threadRoot = root.resolve(THREADS_DIR).resolve(threadId).normalize();
        if (!threadRoot.startsWith(root) || !Files.isDirectory(threadRoot)) return false;
        try (var walk = Files.walk(threadRoot)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
            return true;
        } catch (IOException | UncheckedIOException e) {
            log.warn("delete thread dir {} failed: {}", threadRoot, e.getMessage());
            return false;
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
