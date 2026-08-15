package com.example.gateway.agui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * P8: AG-UI run 可观测性 —— 结构化指标日志 + 成功率 gauge。
 *
 * <p>JSON 行追加写 {@code agui.metrics.file}（默认 logs/run-metrics.log）：
 * <ul>
 *   <li>{@code run_finished} —— runId/threadId/durationMs/outcome(completed|error)</li>
 *   <li>{@code tool_call} —— runId/threadId/tool/durationMs（gateway 观测到的工具耗时）</li>
 *   <li>{@code hitl_wait} —— threadId/actionId/waitMs/decision（HITL 人工确认等待时长）</li>
 * </ul>
 * 成功率（completed/总数）经 micrometer gauge {@code agui.run.success.rate}
 * 暴露到 /actuator/metrics。无 MeterRegistry（测试）时静默跳过。
 */
@Service
public class RunMetricsService {

    private static final Logger log = LoggerFactory.getLogger(RunMetricsService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path metricsFile;
    private final Map<String, Long> runStarts = new ConcurrentHashMap<>();
    private final Map<String, ToolStart> toolStarts = new ConcurrentHashMap<>();
    private final Map<String, Long> hitlStarts = new ConcurrentHashMap<>(); // threadId/actionId -> ts
    private final AtomicLong totalRuns = new AtomicLong();
    private final AtomicLong completedRuns = new AtomicLong();

    private record ToolStart(String tool, long ts) {}

    @org.springframework.beans.factory.annotation.Autowired
    public RunMetricsService(@Value("${agui.metrics.file:logs/run-metrics.log}") String file,
                             ObjectProvider<MeterRegistry> registry) {
        this(Path.of(file), registry.getIfAvailable());
    }

    /** 测试用。 */
    public RunMetricsService(Path file) {
        this(file, null);
    }

    private RunMetricsService(Path file, MeterRegistry registry) {
        this.metricsFile = file.toAbsolutePath().normalize();
        if (registry != null) {
            Gauge.builder("agui.run.success.rate", this, RunMetricsService::successRate)
                    .description("AG-UI run success rate (completed/total)")
                    .register(registry);
            Gauge.builder("agui.run.total", this, RunMetricsService::totalRuns)
                    .description("AG-UI total runs")
                    .register(registry);
        }
    }

    public Path metricsFile() {
        return metricsFile;
    }

    // ------------------------------------------------------------ run ---

    public void runStarted(String runId, String threadId) {
        runStarts.put(runId, System.nanoTime());
    }

    public void runFinished(String runId, String threadId, String outcome) {
        Long start = runStarts.remove(runId);
        long durationMs = start == null ? -1 : (System.nanoTime() - start) / 1_000_000;
        totalRuns.incrementAndGet();
        if ("completed".equals(outcome)) completedRuns.incrementAndGet();
        ObjectNode n = base("run_finished");
        n.put("runId", runId);
        n.put("threadId", threadId);
        n.put("outcome", outcome);
        n.put("durationMs", durationMs);
        write(n);
    }

    // ----------------------------------------------------------- tool ---

    public void toolCallStarted(String runId, String toolCallId, String tool, String threadId) {
        toolStarts.put(toolCallId, new ToolStart(tool, System.nanoTime()));
    }

    public void toolCallEnded(String runId, String toolCallId, String threadId) {
        ToolStart s = toolStarts.remove(toolCallId);
        if (s == null) return;
        ObjectNode n = base("tool_call");
        n.put("runId", runId);
        n.put("threadId", threadId);
        n.put("tool", s.tool());
        n.put("durationMs", (System.nanoTime() - s.ts()) / 1_000_000);
        write(n);
    }

    // ----------------------------------------------------------- HITL ---

    public void hitlInterrupted(String threadId, String actionId) {
        hitlStarts.put(threadId + "/" + actionId, System.nanoTime());
    }

    public void hitlResolved(String threadId, String actionId, String decision) {
        Long start = hitlStarts.remove(threadId + "/" + actionId);
        if (start == null) return; // 无对应 interrupt（重启后等）→ 不计
        ObjectNode n = base("hitl_wait");
        n.put("threadId", threadId);
        n.put("actionId", actionId);
        n.put("decision", decision);
        n.put("waitMs", (System.nanoTime() - start) / 1_000_000);
        write(n);
    }

    // ----------------------------------------------------------- gauge ---

    public double successRate() {
        long total = totalRuns.get();
        return total == 0 ? 1.0 : (double) completedRuns.get() / total;
    }

    public long totalRuns() {
        return totalRuns.get();
    }

    // ---------------------------------------------------------- helper ---

    private static ObjectNode base(String type) {
        ObjectNode n = MAPPER.createObjectNode();
        n.put("ts", Instant.now().toString());
        n.put("type", type);
        return n;
    }

    private synchronized void write(ObjectNode n) {
        try {
            Files.createDirectories(metricsFile.getParent());
            Files.writeString(metricsFile, n + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            // 指标写失败绝不能影响 run 主链路
            log.debug("metrics write failed: {}", e.getMessage());
        } catch (UncheckedIOException e) {
            log.debug("metrics write failed: {}", e.getMessage());
        }
    }
}
