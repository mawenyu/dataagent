package com.example.gateway.agui;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P27: 提示词契约 —— client_tools 段落必须显式声明"数据文件修改只走
 * applySpreadsheetEdits（HITL 确认链路），禁止原生 edit/write 直改"。
 * 背景：审计发现模型偶发绕过 HITL 用原生 edit 直改 CSV。
 */
class FrontendToolBridgeTest {

    private final FrontendToolBridge bridge = new FrontendToolBridge();

    @Test
    void clientToolsSectionDeclaresHitlContractForDataFiles() {
        String section = bridge.buildClientToolsSection(List.of(
                Map.of("name", "applySpreadsheetEdits", "description", "edit cells")));
        assertTrue(section.contains("applySpreadsheetEdits"), "tool listed");
        assertTrue(section.contains("MUST"), "contract is normative: " + section);
        assertTrue(section.toLowerCase().contains("never")
                        && section.contains("edit") && section.contains("write"),
                "native edit/write 直改被显式禁止: " + section);
        assertTrue(section.contains("CSV"), "数据文件类型点名: " + section);
    }

    @Test
    void clientToolsSectionWithoutSpreadsheetToolOmitsHitlClause() {
        String section = bridge.buildClientToolsSection(List.of(
                Map.of("name", "showNotification", "description", "toast")));
        assertFalse(section.contains("NEVER use native file tools"),
                "无表格工具时不加无关约束: " + section);
    }

    @Test
    void emptyToolsProduceEmptySection() {
        assertEquals("", bridge.buildClientToolsSection(List.of()));
    }
}
