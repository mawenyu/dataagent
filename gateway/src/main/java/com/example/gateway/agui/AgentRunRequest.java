package com.example.gateway.agui;

import jakarta.validation.constraints.NotBlank;

/**
 * Request body for {@code POST /agent/run}.
 */
public record AgentRunRequest(@NotBlank String message) {
}
