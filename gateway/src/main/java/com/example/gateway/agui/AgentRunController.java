package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * AG-UI agent run endpoint —— 系统唯一 agent 入口（单一职责：
 * AgUiProtocolService 走真实 OpenCode → LLM 链路，无任何 mock/demo 分支）。
 *
 * <p>POST /agent/run 接受标准 {@link RunAgentInput}，流式输出标准 AG-UI 事件
 * （RUN_STARTED / TEXT_MESSAGE_* / TOOL_CALL_* / REASONING_* /
 * ACTIVITY_SNAPSHOT / RUN_FINISHED / RUN_ERROR）。</p>
 */
@RestController
public class AgentRunController {

    private static final Logger log = LoggerFactory.getLogger(AgentRunController.class);

    private final AgUiProtocolService service;

    public AgentRunController(AgUiProtocolService service) {
        this.service = service;
    }

    @PostMapping(value = "/agent/run", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
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
}
