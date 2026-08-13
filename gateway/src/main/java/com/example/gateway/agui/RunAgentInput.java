package com.example.gateway.agui;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * Standard AG-UI RunAgentInput.
 *
 * <p>This is the public contract of the gateway. It intentionally does NOT
 * expose OpenCode's internal sessionId — threadId is the AG-UI conversation
 * identifier and is mapped to an OpenCode session internally.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record RunAgentInput(
        String threadId,
        String runId,
        JsonNode state,
        List<Map<String, Object>> messages,
        List<Map<String, Object>> tools,
        List<Map<String, Object>> context,
        Map<String, Object> forwardedProps
) {}
