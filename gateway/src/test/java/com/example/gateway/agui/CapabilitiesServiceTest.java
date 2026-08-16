package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GET /agui-api/capabilities —— opencode 能力聚合（agents/skills/commands/plugins/tools
 * 五路并行拉取，单路失败降级空数组；/api/tool 404 时 toolsAvailable=false）。
 *
 * <p>opencode 在 WebClient ExchangeFunction 层打桩，无网络。</p>
 */
class CapabilitiesServiceTest {

    @TempDir
    Path tempDir;

    /** 按路径脚本化响应的 opencode 桩。 */
    private WebClient stubClient(Map<String, Object> routes) {
        return WebClient.builder().exchangeFunction((ClientRequest req) -> {
            String path = req.url().getPath();
            Object scripted = routes.get(path);
            if (scripted == null) {
                return Mono.just(ClientResponse.create(HttpStatus.NOT_FOUND)
                        .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                        .body("{\"error\":\"no stub\"}").build());
            }
            if (scripted instanceof HttpStatus status) {
                return Mono.just(ClientResponse.create(status)
                        .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                        .body("{\"error\":\"boom\"}").build());
            }
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .body((String) scripted).build());
        }).build();
    }

    private Path writePluginToolsFile() throws Exception {
        // 形态照 agents/plugins/a2ui-tools.ts：tools.add({ name: "...", ... })
        Path f = tempDir.resolve("a2ui-tools.ts");
        Files.writeString(f, """
            tools.add({ name: "render_a2ui", options: { codemode: false }, description: "x" })
            tools.add({ name: "request_user_confirm", options: {}, description: "y" })
            """);
        return f;
    }

    private CapabilitiesService service(Map<String, Object> routes) throws Exception {
        return new CapabilitiesService(stubClient(routes), writePluginToolsFile().toString());
    }

    private Map<String, Object> happyRoutes() {
        Map<String, Object> r = new HashMap<>();
        r.put("/api/agent", """
            {"data":[
              {"id":"build","name":"Build","description":"构建","mode":"primary","model":"deepseek/x"},
              {"id":"explore","name":"Explore","mode":"subagent","hidden":true}
            ]}""");
        r.put("/api/command", """
            {"data":[{"name":"init","template":"...","description":"初始化","agent":"build","model":"deepseek/x"}]}""");
        r.put("/api/skill", """
            {"data":[{"id":"sk1","name":"ppt","description":"做PPT","slash":"/ppt","autoinvoke":true,"content":"FULL TEXT MUST BE STRIPPED"}]}""");
        r.put("/api/plugin", """
            {"data":[{"id":"opencode.tool.read"},{"id":"dataagent.a2ui-tools"}]}""");
        r.put("/api/tool", """
            {"data":[
              {"name":"read","description":"读文件","parameters":{}},
              {"name":"render_a2ui","description":"渲染 UI","parameters":{}},
              {"name":"my_custom","description":"自定义","parameters":{}}
            ]}""");
        return r;
    }

    @Test
    void aggregatesAllSectionsWithSourceHeuristic() throws Exception {
        JsonNode res = service(happyRoutes()).capabilities().block();

        assertTrue(res.path("toolsAvailable").asBoolean());
        // agents: hidden 过滤
        JsonNode agents = res.path("agents");
        assertEquals(1, agents.size());
        assertEquals("build", agents.get(0).path("id").asText());
        assertEquals("Build", agents.get(0).path("name").asText());
        assertEquals("构建", agents.get(0).path("description").asText());
        assertEquals("primary", agents.get(0).path("mode").asText());
        assertEquals("deepseek/x", agents.get(0).path("model").asText());
        // skills: content 剥掉
        JsonNode skills = res.path("skills");
        assertEquals(1, skills.size());
        assertEquals("sk1", skills.get(0).path("id").asText());
        assertEquals("/ppt", skills.get(0).path("slash").asText());
        assertTrue(skills.get(0).path("autoinvoke").asBoolean());
        assertTrue(skills.get(0).path("content").isMissingNode(), "skill content 必须剥掉");
        // commands
        JsonNode commands = res.path("commands");
        assertEquals(1, commands.size());
        assertEquals("init", commands.get(0).path("name").asText());
        assertEquals("build", commands.get(0).path("agent").asText());
        // plugins 原样 id 列表
        assertEquals(2, res.path("plugins").size());
        assertEquals("dataagent.a2ui-tools", res.path("plugins").get(1).path("id").asText());
        // serverTools source 启发式
        JsonNode tools = res.path("serverTools");
        assertEquals(3, tools.size());
        assertEquals("builtin", tools.get(0).path("source").asText(), "opencode.tool.read 在插件清单 → builtin");
        assertEquals("plugin", tools.get(1).path("source").asText(), "render_a2ui 在 a2ui-tools.ts → plugin");
        assertEquals("custom", tools.get(2).path("source").asText());
    }

    @Test
    void toolEndpoint404DegradesGracefully() throws Exception {
        Map<String, Object> routes = happyRoutes();
        routes.put("/api/tool", HttpStatus.NOT_FOUND);
        JsonNode res = service(routes).capabilities().block();

        assertFalse(res.path("toolsAvailable").asBoolean());
        assertEquals(0, res.path("serverTools").size());
        // 其余区照常
        assertEquals(1, res.path("agents").size());
        assertEquals(1, res.path("skills").size());
        assertEquals(2, res.path("plugins").size());
    }

    @Test
    void singleSectionFailureDoesNotBreakOthers() throws Exception {
        Map<String, Object> routes = happyRoutes();
        routes.put("/api/agent", HttpStatus.INTERNAL_SERVER_ERROR);
        JsonNode res = service(routes).capabilities().block();

        assertEquals(0, res.path("agents").size(), "失败路空数组");
        assertTrue(res.path("toolsAvailable").asBoolean());
        assertEquals(3, res.path("serverTools").size());
        assertEquals(1, res.path("commands").size());
    }

    @Test
    void missingPluginToolsFileClassifiesBusinessToolsAsCustom() throws Exception {
        CapabilitiesService svc = new CapabilitiesService(
                stubClient(happyRoutes()), tempDir.resolve("nonexistent.ts").toString());
        JsonNode res = svc.capabilities().block();
        JsonNode tools = res.path("serverTools");
        assertEquals("custom", tools.get(1).path("source").asText(),
                "插件工具名清单不可读 → 降级 custom（log.warn 可检索）");
        assertEquals("builtin", tools.get(0).path("source").asText());
    }

    @Test
    void controllerDelegatesToService() throws Exception {
        CapabilitiesService svc = service(happyRoutes());
        JsonNode res = new CapabilitiesController(svc).capabilities().block();
        assertNotNull(res);
        assertTrue(res.has("serverTools"));
        assertTrue(res.has("toolsAvailable"));
    }

    /**
     * 2026-08-16 实测回归：公网 401/前端加载卡死 —— nginx 与 vite 都把
     * /agui-api 前缀 rewrite 剥掉（vite.config.ts rewrite、nginx proxy_pass
     * http://127.0.0.1:8090/），controller 必须映射剥掉后的路径 /capabilities。
     */
    @Test
    void controllerMapsPrefixStrippedPath() throws Exception {
        var m = CapabilitiesController.class.getMethod("capabilities");
        var mapping = m.getAnnotation(org.springframework.web.bind.annotation.GetMapping.class);
        org.junit.jupiter.api.Assertions.assertEquals("/capabilities", mapping.value()[0],
                "nginx/vite 会剥掉 /agui-api 前缀，mapping 不得带前缀");
    }
}
