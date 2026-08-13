package com.example.gateway.agui;

/**
 * Pluggable per-thread authorization hook (TASK §16).
 *
 * <p>NO AUTH in the current environment (user requirement): the default
 * implementation allows everything. When real authentication lands, replace
 * the bean with an implementation that checks the authenticated user against
 * the thread's owner.
 *
 * TODO(security): wire to the real auth principal once Spring Security is introduced.
 */
public interface ThreadAccessPolicy {

    boolean canAccess(String userId, String threadId);
}
