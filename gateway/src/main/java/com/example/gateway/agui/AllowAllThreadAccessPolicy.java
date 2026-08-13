package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Default allow-all policy (TASK §16 simplified security — no auth yet).
 * Reserved extension point only.
 */
@Component
public class AllowAllThreadAccessPolicy implements ThreadAccessPolicy {

    private static final Logger log = LoggerFactory.getLogger(AllowAllThreadAccessPolicy.class);

    @Override
    public boolean canAccess(String userId, String threadId) {
        // TODO(security): enforce thread ownership once auth exists.
        log.debug("thread access (allow-all): user={} thread={}", userId, threadId);
        return true;
    }
}
