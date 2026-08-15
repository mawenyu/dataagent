package com.example.gateway.agui;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

/**
 * A2UI action handler (TASK §13).
 *
 * <p>The browser delivers surface interactions as
 * {@code forwardedProps.a2uiAction} on a new run, with the v0.9 shape
 * {@code {version, action: {name, surfaceId, sourceComponentId, timestamp, context}}}.</p>
 *
 * <p>需求2: 所有 action 一律走真实 agent 续跑 —— {@link #buildAgentPrompt}
 * 把 action 转成 {@code A2UI_ACTION: <json>} prompt 交给 LLM 判断（必要时
 * render_a2ui 更新同名 surface）。不存在任何 Java 侧的固定响应分支。</p>
 */
@Service
public class A2UiActionHandler {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** A2UI_ACTION context prompt for the normal agent run. */
    public String buildAgentPrompt(Object raw) {
        String json;
        try {
            json = MAPPER.writeValueAsString(raw);
        } catch (Exception e) {
            json = String.valueOf(raw);
        }
        return "A2UI_ACTION: " + json + "\n" +
                "The user interacted with an A2UI surface rendered earlier in this conversation " +
                "(see the action name, surfaceId and context above). Decide how to respond: answer " +
                "directly in text, and if the UI should change, call render_a2ui with the SAME surfaceId to " +
                "update that surface in place (keep the existing components, append or replace the result " +
                "section). Actions like 筛选/提交/下钻/刷新 MUST update the surface via render_a2ui, " +
                "not just text. Use the data workspace for any data lookups.";
    }
}
