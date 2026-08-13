package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * Standard AG-UI protocol endpoint.
 *
 * <p>POST /opencode/ag-ui accepts a standard {@link RunAgentInput} and streams
 * standard AG-UI events (RUN_STARTED, TEXT_MESSAGE_*, ACTIVITY_SNAPSHOT,
 * RUN_FINISHED / RUN_ERROR) as SSE. This is the only public contract the Vue
 * frontend talks to — OpenCode's session model stays internal.
 *
 * <p>GET /opencode/ag-ui/a2ui-demo emits a hardcoded A2UI MetricCard snapshot
 * so the frontend A2UI renderer can be verified without any LLM call.
 */
@RestController
@RequestMapping("/opencode")
public class AgUiController {

    private static final Logger log = LoggerFactory.getLogger(AgUiController.class);

    private final AgUiProtocolService service;

    public AgUiController(AgUiProtocolService service) {
        this.service = service;
    }

    @PostMapping(value = "/ag-ui", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> run(
            @RequestBody RunAgentInput input,
            // TODO(security): replace with the authenticated principal once auth exists (TASK §16).
            // Until then: fixed "anonymous" or explicit X-User-Id header passthrough for testing.
            @RequestHeader(value = "X-User-Id", required = false) String userId) {
        log.info("AG-UI run: thread={} run={} messages={} forwardedProps={} user={}",
                input.threadId(), input.runId(),
                input.messages() == null ? 0 : input.messages().size(),
                input.forwardedProps() == null ? "{}" : input.forwardedProps().keySet(),
                userId == null ? "anonymous" : userId);
        return service.run(input, userId);
    }

    @GetMapping(value = "/ag-ui/a2ui-demo", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> a2uiDemo() {
        log.info("AG-UI A2UI demo requested");
        return service.a2uiDemo();
    }
}
