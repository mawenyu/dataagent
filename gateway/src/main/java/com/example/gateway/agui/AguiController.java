package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * AG-UI protocol adapter endpoint.
 *
 * <p>Exposes {@code POST /agent/run} which transforms a simple
 * {@code {message: string}} request into the multi-step OpenCode session
 * protocol and streams the resulting SSE events back to the caller.</p>
 */
@RestController
@RequestMapping("/agent")
public class AguiController {

    private static final Logger log = LoggerFactory.getLogger(AguiController.class);

    private final AguiService aguiService;

    public AguiController(AguiService aguiService) {
        this.aguiService = aguiService;
    }

    @PostMapping(value = "/run", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> run(@RequestBody AgentRunRequest request) {
        log.info("AG-UI /agent/run request received: message length = {}",
                request.message() != null ? request.message().length() : 0);
        return aguiService.run(request.message());
    }
}
