package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * AG-UI agent run endpoints（合并自原 AguiController / AgUiController ——
 * 两个文件名仅大小写不同，在 Windows/macOS 大小写不敏感文件系统上冲突，
 * 用户本地 clone 直接报错，故合并为单一文件）。
 *
 * <ul>
 *   <li>POST /opencode/ag-ui —— 标准 AG-UI 协议端点，Vue 前端唯一契约</li>
 *   <li>POST /agent/run —— 简化适配端点（{message} → 多步 OpenCode 会话编排），
 *       debug 页 /dataagent/copilotkit-test 使用</li>
 *   <li>GET  /opencode/ag-ui/a2ui-demo —— 硬编码 A2UI 演示端点
 *       （需求2 将移除；保留至真实链路验收完成）</li>
 * </ul>
 */
@RestController
public class AgentRunController {

    private static final Logger log = LoggerFactory.getLogger(AgentRunController.class);

    private final AgUiProtocolService service;
    private final AguiService aguiService;

    public AgentRunController(AgUiProtocolService service, AguiService aguiService) {
        this.service = service;
        this.aguiService = aguiService;
    }

    /**
     * Standard AG-UI protocol endpoint: accepts {@link RunAgentInput} and
     * streams standard AG-UI events (RUN_STARTED, TEXT_MESSAGE_*,
     * ACTIVITY_SNAPSHOT, RUN_FINISHED / RUN_ERROR) as SSE.
     */
    @PostMapping(value = "/opencode/ag-ui", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> run(
            @RequestBody RunAgentInput input,
            // TODO(security): replace with the authenticated principal once auth exists (TASK §16).
            @RequestHeader(value = "X-User-Id", required = false) String userId) {
        log.info("AG-UI run: thread={} run={} messages={} forwardedProps={} user={}",
                input.threadId(), input.runId(),
                input.messages() == null ? 0 : input.messages().size(),
                input.forwardedProps() == null ? "{}" : input.forwardedProps().keySet(),
                userId == null ? "anonymous" : userId);
        return service.run(input, userId);
    }

    /** Simplified adapter: {message} → multi-step OpenCode session, raw event passthrough. */
    @PostMapping(value = "/agent/run", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> runSimple(@RequestBody AgentRunRequest request) {
        log.info("AG-UI /agent/run request received: message length = {}",
                request.message() != null ? request.message().length() : 0);
        return aguiService.run(request.message());
    }

    /** Hardcoded A2UI MetricCard demo surface (no LLM call). TODO(需求2): remove. */
    @GetMapping(value = "/opencode/ag-ui/a2ui-demo", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> a2uiDemo() {
        log.info("AG-UI A2UI demo requested");
        return service.a2uiDemo();
    }
}
