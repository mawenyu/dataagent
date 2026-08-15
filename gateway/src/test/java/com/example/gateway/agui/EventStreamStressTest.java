package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P16: AG-UI 事件流压测（docs/perf/event-stream-stress.md）。
 * 单 run 1000+ OpenCode 事件（token 流 + 多工具交错 + 乱序）下
 * translator 的顺序一致性与内存稳定。
 */
class EventStreamStressTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static ServerSentEvent<String> oc(String type, String dataJson) {
        return ServerSentEvent.<String>builder()
                .data("{\"type\":\"" + type + "\",\"data\":" + dataJson + "}").build();
    }

    private static ServerSentEvent<String> ocSeq(String type, String dataJson, long seq) {
        return ServerSentEvent.<String>builder()
                .data("{\"type\":\"" + type + "\",\"durable\":{\"seq\":" + seq + "},\"data\":" + dataJson + "}").build();
    }

    private AguiEventTranslator newTranslator() {
        A2UiService a2Ui = new A2UiService();
        return new AguiEventTranslator(new FrontendToolBridge(),
                new A2UiBridgeService(a2Ui, new A2UiSurfaceRegistry()));
    }

    private List<JsonNode> translate(Flux<ServerSentEvent<String>> events) {
        return newTranslator().translate("thread", "run", java.util.Set.of(), events)
                .map(ServerSentEvent::data)
                .map(d -> {
                    try {
                        return MAPPER.readTree(d);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                })
                .collectList().block(java.time.Duration.ofSeconds(60));
    }

    /** 构造 ~1200 事件流：reasoning + 1000 text delta + 5 个交错工具调用 + step 结束。 */
    static List<ServerSentEvent<String>> bigStream(boolean withSeq, boolean shufflePairs) {
        List<ServerSentEvent<String>> ev = new ArrayList<>();
        long[] seq = {0};
        // 真实契约：delta 事件无 seq（锚定所属流最近的有 seq 事件）；
        // 只有非 delta 事件带 durable.seq
        java.util.function.BiFunction<String, String, ServerSentEvent<String>> emit = (type, data) ->
                (withSeq && !type.contains(".delta")) ? ocSeq(type, data, ++seq[0]) : oc(type, data);

        ev.add(emit.apply("session.step.started", "{\"assistantMessageID\":\"m1\"}"));
        ev.add(emit.apply("session.reasoning.started", "{\"assistantMessageID\":\"m1\"}"));
        for (int i = 0; i < 50; i++) {
            ev.add(emit.apply("session.reasoning.delta",
                    "{\"assistantMessageID\":\"m1\",\"delta\":\"思" + i + "\"}"));
        }
        ev.add(emit.apply("session.reasoning.ended", "{\"assistantMessageID\":\"m1\"}"));
        ev.add(emit.apply("session.text.started", "{\"assistantMessageID\":\"m1\"}"));
        // 1000 个 text delta，其中交错 5 个工具调用（每个 started+ended+called）
        int toolAt = 0;
        for (int i = 0; i < 1000; i++) {
            ev.add(emit.apply("session.text.delta",
                    "{\"assistantMessageID\":\"m1\",\"delta\":\"d" + i + "\"}"));
            if (i % 200 == 100 && toolAt < 5) {
                String cid = "c" + toolAt;
                ev.add(emit.apply("session.tool.input.started",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"" + cid + "\",\"name\":\"shell\"}"));
                ev.add(emit.apply("session.tool.input.ended",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"" + cid + "\",\"text\":\"ls " + toolAt + "\"}"));
                ev.add(emit.apply("session.tool.called",
                        "{\"assistantMessageID\":\"m1\",\"id\":\"" + cid + "\",\"input\":{\"command\":\"ls " + toolAt + "\"}}"));
                toolAt++;
            }
        }
        ev.add(emit.apply("session.text.ended", "{\"assistantMessageID\":\"m1\"}"));
        ev.add(emit.apply("session.step.ended",
                "{\"assistantMessageID\":\"m1\",\"finish\":\"stop\",\"cost\":0,"
                        + "\"tokens\":{\"input\":1,\"output\":2,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}"));

        if (shufflePairs) {
            // 真实乱序模型：带 seq 的非 delta 事件跨 key 错位（tool.called 早于
            // 其 input.ended 到达等）——orderer TreeMap 按无缺口前缀下发，应自愈；
            // delta 不带 seq 锚定所属流，天然不参与乱序。
            List<ServerSentEvent<String>> shuffled = new ArrayList<>(ev);
            for (int i = 0; i + 1 < shuffled.size(); i++) {
                String a = shuffled.get(i).data();
                String b = shuffled.get(i + 1).data();
                if (a != null && b != null
                        && a.contains("session.tool.input.ended") && b.contains("session.tool.called")) {
                    // tool.called(seq 大) 先于 input.ended(seq 小) 到达
                    shuffled.set(i, shuffled.get(i + 1));
                    shuffled.set(i + 1, shuffled.get(i));
                }
            }
            return shuffled;
        }
        return ev;
    }

    @Test
    void thousandEventsInOrderPreserved() {
        List<JsonNode> events = translate(Flux.fromIterable(bigStream(false, false)));
        List<String> types = events.stream().map(e -> e.path("type").asText()).toList();

        String text = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        // 顺序一致性：d0d1d2...d999 严格拼接
        StringBuilder expect = new StringBuilder();
        for (int i = 0; i < 1000; i++) expect.append("d").append(i);
        assertEquals(expect.toString(), text, "1000 delta 顺序一致性");

        String reasoning = events.stream()
                .filter(e -> "REASONING_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        StringBuilder expectR = new StringBuilder();
        for (int i = 0; i < 50; i++) expectR.append("思").append(i);
        assertEquals(expectR.toString(), reasoning, "reasoning 顺序一致性");

        assertEquals(5, types.stream().filter("TOOL_CALL_START"::equals).count(), "5 工具调用全透传");
        assertEquals(5, types.stream().filter("TOOL_CALL_END"::equals).count());
        assertEquals("RUN_FINISHED", types.get(types.size() - 1));
        assertTrue(events.size() > 1000, "AG-UI 侧事件数: " + events.size());
    }

    @Test
    void thousandEventsOutOfOrderReordered() {
        List<JsonNode> events = translate(Flux.fromIterable(bigStream(true, true)));
        String text = events.stream()
                .filter(e -> "TEXT_MESSAGE_CONTENT".equals(e.path("type").asText()))
                .map(e -> e.path("delta").asText()).reduce("", String::concat);
        StringBuilder expect = new StringBuilder();
        for (int i = 0; i < 1000; i++) expect.append("d").append(i);
        assertEquals(expect.toString(), text, "乱序流重排后 delta 顺序一致");
    }

    @Test
    void memoryStableAcrossRepeatedBigStreams() throws Exception {
        // 预热 + 首次稳定
        for (int i = 0; i < 3; i++) translate(Flux.fromIterable(bigStream(false, false)));
        System.gc();
        Thread.sleep(50);
        long before = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        for (int i = 0; i < 15; i++) {
            List<JsonNode> out = translate(Flux.fromIterable(bigStream(false, false)));
            assertFalse(out.isEmpty());
        }
        System.gc();
        Thread.sleep(50);
        long after = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        long growthMb = (after - before) / 1024 / 1024;
        System.out.printf("[STRESS] 15×1200 事件流后堆增长: %dMB（before=%d after=%d）%n",
                growthMb, before / 1024 / 1024, after / 1024 / 1024);
        assertTrue(growthMb < 64, "translator 无状态泄漏（增长 " + growthMb + "MB）");
    }
}
