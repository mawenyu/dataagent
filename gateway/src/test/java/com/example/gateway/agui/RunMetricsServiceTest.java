package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P8: gateway 可观测性 —— RunMetricsService 结构化指标日志。
 * JSON 行写 logs/run-metrics.log（类型: run_finished/tool_call/hitl_wait），
 * 成功率经 MeterRegistry gauge 暴露到 /actuator/metrics。
 */
class RunMetricsServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path dir;

    private RunMetricsService newService() {
        return new RunMetricsService(dir.resolve("run-metrics.log"));
    }

    private List<JsonNode> lines(RunMetricsService svc) throws Exception {
        return Files.readAllLines(svc.metricsFile()).stream()
                .filter(l -> !l.isBlank())
                .map(l -> {
                    try {
                        return MAPPER.readTree(l);
                    } catch (Exception e) {
                        throw new RuntimeException("bad json line: " + l, e);
                    }
                })
                .toList();
    }

    @Test
    void runLifecycleWritesStructuredLine() throws Exception {
        RunMetricsService svc = newService();
        svc.runStarted("run-1", "thread-1");
        Thread.sleep(5);
        svc.runFinished("run-1", "thread-1", "completed");

        List<JsonNode> ls = lines(svc);
        assertEquals(1, ls.size());
        JsonNode n = ls.get(0);
        assertEquals("run_finished", n.path("type").asText());
        assertEquals("run-1", n.path("runId").asText());
        assertEquals("thread-1", n.path("threadId").asText());
        assertEquals("completed", n.path("outcome").asText());
        assertTrue(n.path("durationMs").asLong() >= 0);
        assertFalse(n.path("ts").asText().isBlank());
    }

    @Test
    void toolCallDurationRecorded() throws Exception {
        RunMetricsService svc = newService();
        svc.runStarted("run-1", "t1");
        svc.toolCallStarted("run-1", "call-9", "shell", "t1");
        Thread.sleep(5);
        svc.toolCallEnded("run-1", "call-9", "t1");
        svc.runFinished("run-1", "t1", "completed");

        List<JsonNode> ls = lines(svc);
        JsonNode tool = ls.stream().filter(n -> "tool_call".equals(n.path("type").asText()))
                .findFirst().orElseThrow();
        assertEquals("shell", tool.path("tool").asText());
        assertEquals("t1", tool.path("threadId").asText());
        assertTrue(tool.path("durationMs").asLong() >= 0);
    }

    @Test
    void hitlWaitRecordedOnDecision() throws Exception {
        RunMetricsService svc = newService();
        svc.hitlInterrupted("t1", "act-1");
        Thread.sleep(5);
        svc.hitlResolved("t1", "act-1", "confirm");

        List<JsonNode> ls = lines(svc);
        JsonNode n = ls.stream().filter(x -> "hitl_wait".equals(x.path("type").asText()))
                .findFirst().orElseThrow();
        assertEquals("act-1", n.path("actionId").asText());
        assertEquals("confirm", n.path("decision").asText());
        assertTrue(n.path("waitMs").asLong() >= 0);
    }

    @Test
    void hitlResolvedWithoutInterruptIsIgnored() throws Exception {
        RunMetricsService svc = newService();
        svc.hitlResolved("t1", "ghost", "cancel"); // 无对应 interrupt
        assertFalse(Files.exists(svc.metricsFile()));
    }

    @Test
    void successRateGaugeValue() {
        RunMetricsService svc = newService();
        assertEquals(1.0, svc.successRate(), 1e-9, "无数据时 1.0（无可失败项）");
        svc.runStarted("r1", "t");
        svc.runFinished("r1", "t", "completed");
        svc.runStarted("r2", "t");
        svc.runFinished("r2", "t", "completed");
        svc.runStarted("r3", "t");
        svc.runFinished("r3", "t", "error");
        assertEquals(2.0 / 3.0, svc.successRate(), 1e-9);
        assertEquals(3, svc.totalRuns());
    }

    @Test
    void errorOutcomeRecorded() throws Exception {
        RunMetricsService svc = newService();
        svc.runStarted("run-x", "t");
        svc.runFinished("run-x", "t", "error");
        JsonNode n = lines(svc).get(0);
        assertEquals("error", n.path("outcome").asText());
    }

    // ---- P14: HITL 并发裁决 ----

    @Test
    void outOfOrderResolvesRecordedIndependently() throws Exception {
        RunMetricsService svc = newService();
        svc.hitlInterrupted("t1", "act-1");
        Thread.sleep(3);
        svc.hitlInterrupted("t1", "act-2");
        Thread.sleep(3);
        // 乱序裁决：先 act-2 后 act-1
        svc.hitlResolved("t1", "act-2", "confirm");
        svc.hitlResolved("t1", "act-1", "cancel");

        List<JsonNode> ls = lines(svc);
        assertEquals(2, ls.size());
        JsonNode first = ls.get(0);
        JsonNode second = ls.get(1);
        assertEquals("act-2", first.path("actionId").asText());
        assertEquals("confirm", first.path("decision").asText());
        assertEquals("act-1", second.path("actionId").asText());
        assertEquals("cancel", second.path("decision").asText());
        // act-1 等待时长 > act-2（先开始先结束于后）—— 只断言非负且各自独立
        assertTrue(first.path("waitMs").asLong() >= 0);
        assertTrue(second.path("waitMs").asLong() >= first.path("waitMs").asLong());
    }

    @Test
    void crossThreadResolutionDoesNotConsume() throws Exception {
        RunMetricsService svc = newService();
        svc.hitlInterrupted("thread-A", "act-1");
        svc.hitlResolved("thread-B", "act-1", "confirm"); // 别的会话同 actionId
        assertFalse(Files.exists(svc.metricsFile()), "跨会话不得消费待决卡");
        svc.hitlResolved("thread-A", "act-1", "confirm");
        assertEquals(1, lines(svc).size(), "本会话裁决正常记录");
    }

    @Test
    void duplicateResolveOnlyCountsOnce() throws Exception {
        RunMetricsService svc = newService();
        svc.hitlInterrupted("t1", "act-1");
        svc.hitlResolved("t1", "act-1", "confirm");
        svc.hitlResolved("t1", "act-1", "confirm"); // 重复点击/重放
        assertEquals(1, lines(svc).size(), "重复裁决只记一次（起点已消费）");
    }
}
