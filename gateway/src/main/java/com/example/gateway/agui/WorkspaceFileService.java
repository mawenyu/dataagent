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
 *   <li>上传大小上限（agui.files.max-upload-size，默认 50MB —— 2026-08-15 从 5MB 上调，数据分析大文件场景）</li>
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
            @org.springframework.beans.factory.annotation.Value("${agui.files.max-upload-size:50MB}") org.springframework.util.unit.DataSize maxUpload) {
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

    /** P-N: 目录层级上限。 */
    private static final int MAX_PATH_DEPTH = 8;

    /**
     * P-N: 相对路径校验(逐段 NAME_PATTERN、禁 ".."/反斜杠/空段、深度 ≤ 8),
     * 解析为根内路径;rel 为空 → 根目录本身。非法返回 empty。
     */
    public Optional<Path> resolvePath(String rel) {
        if (rel == null || rel.isBlank()) return Optional.of(root);
        // Spring {*name} 捕获多段路径时带前导斜杠 —— 归一掉(绝对路径语义在此无意义)
        if (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.isBlank()) return Optional.of(root);
        if (rel.contains("..") || rel.contains("\\")) return Optional.empty();
        String[] segs = rel.split("/");
        if (segs.length > MAX_PATH_DEPTH) return Optional.empty();
        for (String seg : segs) {
            if (!NAME_PATTERN.matcher(seg).matches()) return Optional.empty();
        }
        Path p = root.resolve(rel).normalize();
        if (!p.startsWith(root)) return Optional.empty();
        return Optional.of(p);
    }

    /** P-N: 目录列表结果(子目录名 + 文件)。 */
    public record DirListing(List<String> dirs, List<FileInfo> files) {}

    /**
     * P-N: 列出 rel 目录内容(目录名升序 + 文件按 list() 同规则)。
     * 共享根(service 根实例)隐藏会话隔离内部目录 threads/。
     */
    public DirListing listDir(String rel) {
        Optional<Path> target = resolvePath(rel);
        if (target.isEmpty() || !Files.isDirectory(target.get())) {
            return new DirListing(List.of(), List.of());
        }
        boolean isRootService = sharedRoot != null;
        boolean atRoot = target.get().equals(root);
        try (var stream = Files.list(target.get())) {
            List<Path> all = stream.toList();
            List<String> dirs = all.stream()
                    .filter(Files::isDirectory)
                    .map(p -> p.getFileName().toString())
                    .filter(n -> NAME_PATTERN.matcher(n).matches())
                    .filter(n -> !(isRootService && atRoot && THREADS_DIR.equals(n)))
                    .sorted()
                    .toList();
            List<FileInfo> files = all.stream()
                    .filter(Files::isRegularFile)
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
            return new DirListing(dirs, files);
        } catch (IOException e) {
            log.warn("listDir {} failed: {}", rel, e.getMessage());
            return new DirListing(List.of(), List.of());
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
        // P-N: resolvePath 支持子目录相对路径(单段与 resolve 等价)
        return resolvePath(name).filter(Files::isRegularFile).map(FileSystemResource::new);
    }

    /** 上传（覆盖同名）。返回写入字节数；非法名/超限/写失败 → empty。 */
    public Optional<FileInfo> store(String name, byte[] content) {
        if (content == null || content.length == 0) return Optional.empty();
        if (content.length > maxUploadBytes) {
            log.warn("upload rejected: {} bytes > limit {}", content.length, maxUploadBytes);
            return Optional.empty();
        }
        // P-N: resolvePath 支持写入子目录(父目录须已存在)
        return resolvePath(name).flatMap(p -> {
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
        // P-N: resolvePath 支持删除子目录内文件
        return resolvePath(name).filter(Files::isRegularFile).map(p -> {
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
