package com.example.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Ensures AG-UI SSE streams are forwarded correctly to the client.
 *
 * <p>The filter adds the headers that browsers and SSE clients require for
 * streaming responses, and it avoids buffering the event stream so that AG-UI
 * events arrive as soon as the OpenCode server emits them.</p>
 */
@Component
public class SseAguiGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(SseAguiGlobalFilter.class);

    private static final String TEXT_EVENT_STREAM = MediaType.TEXT_EVENT_STREAM_VALUE;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String accept = exchange.getRequest().getHeaders().getFirst(HttpHeaders.ACCEPT);
        boolean isSseRequest = accept != null && accept.contains(TEXT_EVENT_STREAM);

        if (isSseRequest) {
            log.info("AG-UI SSE request: {}", exchange.getRequest().getURI());

            exchange.getResponse().getHeaders().set(HttpHeaders.CACHE_CONTROL, "no-cache, no-store, must-revalidate");
            exchange.getResponse().getHeaders().set(HttpHeaders.PRAGMA, "no-cache");
            exchange.getResponse().getHeaders().set(HttpHeaders.CONNECTION, "keep-alive");
        }

        return chain.filter(exchange)
                .doOnSuccess(aVoid -> {
                    if (isSseRequest) {
                        log.info("AG-UI SSE stream completed: {}", exchange.getRequest().getURI());
                    }
                })
                .doOnError(throwable -> log.error("AG-UI SSE stream failed for {}: {}",
                        exchange.getRequest().getURI(), throwable.getMessage()));
    }

    @Override
    public int getOrder() {
        // Run early so SSE headers are in place before Netty commits the response.
        return Ordered.HIGHEST_PRECEDENCE + 100;
    }
}
