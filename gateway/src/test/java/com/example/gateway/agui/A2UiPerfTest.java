package com.example.gateway.agui;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * vision-P5-2: A2UI 性能基线（docs/perf/a2ui-baseline.md）。
 * gateway 侧：execute/validate 在上限规模（100 组件 / ~64KB 上限内）的耗时。
 * 断言用宽松上限防回归（不是精确基准），实测数值打印进 surefire 输出。
 */
class A2UiPerfTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final A2UiBridgeService bridge =
            new A2UiBridgeService(new A2UiService(), new A2UiSurfaceRegistry());

    /** 构造 n 个组件的 surface args（Row×10 + MetricCard×(n-11) + Column root）。 */
    private ObjectNode bigArgs(int n) {
        ObjectNode args = MAPPER.createObjectNode();
        args.put("surfaceId", "perf");
        ArrayNode comps = args.putArray("components");
        ObjectNode root = MAPPER.createObjectNode();
        root.put("component", "Column");
        root.put("id", "root");
        ArrayNode children = root.putArray("children");
        for (int i = 0; i < n - 1; i++) {
            ObjectNode c = MAPPER.createObjectNode();
            c.put("component", "MetricCard");
            c.put("id", "m" + i);
            c.put("title", "指标卡 " + i + " —— 含一段不算短的标题文字用来膨胀 payload");
            c.put("value", "¥" + (100000 + i));
            c.put("delta", "+12.4% 环比增长，备注文字继续膨胀 payload 体积");
            c.put("trend", "up");
            comps.add(c);
            children.add("m" + i);
        }
        comps.insert(0, root);
        return args;
    }

    @Test
    void executeAtComponentCapIsFast() {
        ObjectNode args = bigArgs(A2UiBridgeService.MAX_COMPONENTS_FOR_TEST);
        int payloadChars = args.toString().length();
        // 预热 JIT
        for (int i = 0; i < 20; i++) bridge.execute("r", "t", args);

        long best = Long.MAX_VALUE;
        long total = 0;
        int runs = 50;
        for (int i = 0; i < runs; i++) {
            long t0 = System.nanoTime();
            assertTrue(bridge.execute("r", "t", args).isPresent());
            long d = System.nanoTime() - t0;
            best = Math.min(best, d);
            total += d;
        }
        System.out.printf("[PERF] gateway execute: components=%d payload=%d chars | best=%.2fms avg=%.2fms%n",
                A2UiBridgeService.MAX_COMPONENTS_FOR_TEST, payloadChars,
                best / 1e6, total / 1e6 / runs);

        long t0 = System.nanoTime();
        assertNull(bridge.validate(args));
        long validateMs = (System.nanoTime() - t0) / 1_000_000;
        System.out.printf("[PERF] gateway validate: %dms%n", validateMs);

        // 宽松回归线：上限规模 execute 均值 < 200ms（实测预期 <<10ms）
        assertTrue(total / 1e6 / runs < 200, "execute at cap regressed");
    }

    @Test
    void oversizedPayloadRejectedFast() {
        ObjectNode args = bigArgs(A2UiBridgeService.MAX_COMPONENTS_FOR_TEST + 50);
        long t0 = System.nanoTime();
        String reason = bridge.validate(args);
        long d = System.nanoTime() - t0;
        assertNotNull(reason);
        assertTrue(reason.contains("too large"), reason);
        System.out.printf("[PERF] oversized reject: %d components in %.2fms (%s)%n",
                A2UiBridgeService.MAX_COMPONENTS_FOR_TEST + 50, d / 1e6, reason);
        assertTrue(d / 1e6 < 1000, "rejection should be fast");
    }
}
