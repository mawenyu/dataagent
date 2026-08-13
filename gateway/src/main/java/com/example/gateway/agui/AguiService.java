package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyExtractors;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * Adapts the AG-UI protocol to the OpenCode server API.
 *
 * <p>The orchestration is:</p>
 * <ol>
 *   <li>Create a session: {@code POST /api/session}</li>
 *   <li>Set the model: {@code POST /api/session/{id}/model}</li>
 *   <li>Send the user prompt: {@code POST /api/session/{id}/prompt}</li>
 *   <li>Stream events: {@code GET /api/event?sessionID={id}}</li>
 * </ol>
 */
@Service
public class AguiService {

    private static final Logger log = LoggerFactory.getLogger(AguiService.class);

    private static final String MODEL_ID = "deepseek-chat";
    private static final String PROVIDER_ID = "deepseek";

    private final WebClient webClient;

    public AguiService(WebClient opencodeWebClient) {
        this.webClient = opencodeWebClient;
    }

    /**
     * Runs the full AG-UI agent flow and returns an SSE stream of backend events.
     */
    public Flux<ServerSentEvent<String>> run(String message) {
        return createSession()
                .flatMapMany(sessionId ->
                        setModel(sessionId)
                                .then(sendPrompt(sessionId, message))
                                .thenMany(streamEvents(sessionId))
                                .doOnSubscribe(s -> log.info("AG-UI run started for session {}", sessionId))
                                .doOnComplete(() -> log.info("AG-UI run completed for session {}", sessionId))
                                .doOnError(e -> log.error("AG-UI run failed for session {}: {}", sessionId, e.getMessage()))
                )
                .onErrorResume(this::errorEvent);
    }

    private Mono<String> createSession() {
        return webClient.post()
                .uri("/api/session")
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .map(node -> {
                    JsonNode data = node.get("data");
                    if (data == null || !data.has("id")) {
                        throw new IllegalStateException("Session response missing data.id: " + node);
                    }
                    return data.get("id").asText();
                });
    }

    private Mono<Void> setModel(String sessionId) {
        return webClient.post()
                .uri("/api/session/{id}/model", sessionId)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of("model", Map.of(
                        "id", MODEL_ID,
                        "providerID", PROVIDER_ID)))
                .retrieve()
                .toBodilessEntity()
                .then()
                .doOnSuccess(v -> log.info("Model set for session {} ({} / {})", sessionId, MODEL_ID, PROVIDER_ID));
    }

    private Mono<Void> sendPrompt(String sessionId, String message) {
        return webClient.post()
                .uri("/api/session/{id}/prompt", sessionId)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(Map.of("prompt", Map.of("text", message)))
                .retrieve()
                .toBodilessEntity()
                .then()
                .doOnSuccess(v -> log.info("Prompt sent for session {}", sessionId));
    }

    private Flux<ServerSentEvent<String>> streamEvents(String sessionId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/event")
                        .queryParam("sessionID", sessionId)
                        .build())
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchangeToFlux(response -> {
                    if (!response.statusCode().is2xxSuccessful()) {
                        return response.bodyToMono(String.class)
                                .flatMapMany(body -> Flux.error(new IllegalStateException(
                                        "Event stream returned " + response.statusCode() + ": " + body)));
                    }
                    return response.body(BodyExtractors.toFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {
                    }));
                })
                .filter(event -> event.data() != null || event.event() != null || event.id() != null)
                .doOnNext(event -> log.debug("AG-UI SSE event from session {}: {}", sessionId, event));
    }

    private Flux<ServerSentEvent<String>> errorEvent(Throwable throwable) {
        return Flux.just(ServerSentEvent.<String>builder()
                .event("error")
                .data(throwable.getMessage())
                .build());
    }
}
