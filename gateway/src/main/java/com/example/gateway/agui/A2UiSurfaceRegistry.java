package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * Thread-scoped A2UI surface registry (TASK §14).
 *
 * <p>Tracks, per (userId, threadId, surfaceId): the AG-UI activity messageId,
 * the catalogId, and the last components/data sent. Updating a surface reuses
 * the same messageId with ACTIVITY_SNAPSHOT replace=true, so the client
 * updates the existing activity message in place instead of appending.
 *
 * <p>userId is carried for isolation even though the current environment has
 * no real authentication (TASK §16 — fixed "anonymous" / header passthrough;
 * TODO when auth lands).
 */
@Service
public class A2UiSurfaceRegistry {

    private static final Logger log = LoggerFactory.getLogger(A2UiSurfaceRegistry.class);

    public record SurfaceState(
            String userId,
            String threadId,
            String surfaceId,
            String activityMessageId,
            String catalogId,
            JsonNode components,
            JsonNode data,
            long updatedAt) {}

    private final Map<String, SurfaceState> surfaces = new ConcurrentHashMap<>();

    private String key(String userId, String threadId, String surfaceId) {
        return userId + '\n' + threadId + '\n' + surfaceId;
    }

    /** The stable activity messageId for a surface (deterministic). */
    public String messageIdFor(String surfaceId) {
        return "a2ui-" + surfaceId;
    }

    public SurfaceState register(String userId, String threadId, String surfaceId,
                                 String catalogId, JsonNode components, JsonNode data) {
        SurfaceState state = new SurfaceState(userId, threadId, surfaceId,
                messageIdFor(surfaceId), catalogId, components, data, System.currentTimeMillis());
        surfaces.put(key(userId, threadId, surfaceId), state);
        log.debug("surface registered: user={} thread={} surface={} msg={}",
                userId, threadId, surfaceId, state.activityMessageId());
        return state;
    }

    public Optional<SurfaceState> find(String userId, String threadId, String surfaceId) {
        return Optional.ofNullable(surfaces.get(key(userId, threadId, surfaceId)));
    }
}
