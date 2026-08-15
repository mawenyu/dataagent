package com.example.gateway;

import com.example.gateway.agui.WorkspaceFileService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Spring 上下文冒烟测试 —— 防止"单测全绿但启动崩"（2026-08-15 实测：
 * WorkspaceFileService 多构造器未标 @Autowired → NoSuchMethodException，
 * 单测全绿但 jar 启动即崩）。
 */
@SpringBootTest
class GatewayApplicationSmokeTest {

    @Autowired
    private WorkspaceFileService workspaceFileService;

    @Test
    void contextLoadsAndWorkspaceFileServiceIsInstantiable() {
        assertNotNull(workspaceFileService);
    }
}
