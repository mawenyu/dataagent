package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * GET /agui-api/capabilities 的聚合服务 —— 前端能力面板的唯一数据源。
 *
 * <p>五路并行（Mono.zip）真实拉取 opencode server：/api/agent、/api/command、
 * /api/skill、/api/plugin、/api/tool。禁写死清单。单路失败不拖垮整体：
 * 该路空数组 + log.warn；/api/tool 目前 404（opencode-fork 另一线新增中），
 * 失败时 serverTools 空数组且 toolsAvailable=false，其余区照常。</p>
 *
 * <p>serverTools.source 启发式：插件清单含 {@code opencode.tool.<name>} → builtin；
 * 工具名命中业务插件注册的工具名（从 agents/plugins/a2ui-tools.ts 源码
 * {@code name: "..."} 提取，不写死字符串）→ plugin；其余 → custom。</p>
 */
@Service
public class CapabilitiesService {

    private static final Logger log = LoggerFactory.getLogger(CapabilitiesService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    /** 插件 TS 源码里的工具注册名：name: "render_a2ui" 等。 */
    private static final Pattern TOOL_NAME = Pattern.compile("name:\\s*\"([^\"]+)\"");
    private static final String BUILTIN_TOOL_PLUGIN_PREFIX = "opencode.tool.";

    private final WebClient webClient;
    private final String pluginToolsFile;
    /** 业务插件工具名缓存（文件内容运行期不变，读一次即可；null = 未加载）。 */
    private volatile Set<String> pluginToolNames;

    public CapabilitiesService(WebClient opencodeWebClient,
                               @Value("${opencode.plugin-tools-file:agents/plugins/a2ui-tools.ts}")
                               String pluginToolsFile) {
        this.webClient = opencodeWebClient;
        this.pluginToolsFile = pluginToolsFile;
    }

    public Mono<JsonNode> capabilities() {
        Mono<List<JsonNode>> agents = fetchDataArray("/api/agent");
        Mono<List<JsonNode>> commands = fetchDataArray("/api/command");
        Mono<List<JsonNode>> skills = fetchDataArray("/api/skill");
        Mono<List<JsonNode>> plugins = fetchDataArray("/api/plugin");
        Mono<ToolFetch> tools = fetchTools();
        return Mono.zip(agents, commands, skills, plugins, tools)
                .map(t -> assemble(t.getT1(), t.getT2(), t.getT3(), t.getT4(), t.getT5()));
    }

    /** 通用拉取：{data:[...]} → List<JsonNode>；任何失败 → 空数组 + log.warn。 */
    private Mono<List<JsonNode>> fetchDataArray(String path) {
        return webClient.get()
                .uri(path)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .map(this::parseDataArray)
                .onErrorResume(e -> {
                    log.warn("capabilities: {} 拉取失败（该路降级空数组）: {}", path, e.toString());
                    return Mono.just(List.of());
                });
    }

    /** /api/tool 单路：失败（404/连接拒绝等）→ available=false，与其余路区分语义。 */
    private Mono<ToolFetch> fetchTools() {
        return webClient.get()
                .uri("/api/tool")
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .map(body -> new ToolFetch(parseDataArray(body), true))
                .onErrorResume(e -> {
                    log.warn("capabilities: /api/tool 不可用（toolsAvailable=false，serverTools 空数组）: {}",
                            e.toString());
                    return Mono.just(new ToolFetch(List.of(), false));
                });
    }

    private List<JsonNode> parseDataArray(String body) {
        List<JsonNode> out = new ArrayList<>();
        try {
            JsonNode data = MAPPER.readTree(body).path("data");
            if (data.isArray()) data.forEach(out::add);
        } catch (Exception e) {
            log.warn("capabilities: 响应体解析失败（降级空数组）: {}", e.toString());
        }
        return out;
    }

    private ObjectNode assemble(List<JsonNode> agents, List<JsonNode> commands,
                                List<JsonNode> skills, List<JsonNode> plugins,
                                ToolFetch tools) {
        ObjectNode res = MAPPER.createObjectNode();

        Set<String> pluginIds = new TreeSet<>();
        ArrayNode pluginsArr = res.putArray("plugins");
        for (JsonNode p : plugins) {
            String id = p.path("id").asText("");
            if (id.isBlank()) continue;
            pluginIds.add(id);
            ObjectNode o = MAPPER.createObjectNode();
            o.put("id", id);
            pluginsArr.add(o);
        }

        ArrayNode toolsArr = res.putArray("serverTools");
        if (tools.available()) {
            Set<String> businessToolNames = loadPluginToolNames();
            for (JsonNode t : tools.items()) {
                String name = t.path("name").asText("");
                if (name.isBlank()) continue;
                ObjectNode o = MAPPER.createObjectNode();
                o.put("name", name);
                putIfText(o, "description", t);
                o.put("source", classifyToolSource(name, pluginIds, businessToolNames));
                toolsArr.add(o);
            }
        }

        ArrayNode agentsArr = res.putArray("agents");
        for (JsonNode a : agents) {
            if (a.path("hidden").asBoolean(false)) continue;
            ObjectNode o = MAPPER.createObjectNode();
            o.put("id", a.path("id").asText(""));
            o.put("name", a.path("name").asText(""));
            putIfText(o, "description", a);
            putIfText(o, "mode", a);
            putIfText(o, "model", a);
            agentsArr.add(o);
        }

        ArrayNode skillsArr = res.putArray("skills");
        for (JsonNode s : skills) {
            ObjectNode o = MAPPER.createObjectNode();
            o.put("id", s.path("id").asText(""));
            o.put("name", s.path("name").asText(""));
            putIfText(o, "description", s);
            putIfText(o, "slash", s);
            if (s.has("autoinvoke")) o.put("autoinvoke", s.path("autoinvoke").asBoolean());
            // content 是全文，必须剥掉（契约不含此字段）
            skillsArr.add(o);
        }

        ArrayNode commandsArr = res.putArray("commands");
        for (JsonNode c : commands) {
            ObjectNode o = MAPPER.createObjectNode();
            o.put("name", c.path("name").asText(""));
            putIfText(o, "description", c);
            putIfText(o, "agent", c);
            putIfText(o, "model", c);
            commandsArr.add(o);
        }

        res.put("toolsAvailable", tools.available());
        return res;
    }

    private static void putIfText(ObjectNode o, String field, JsonNode src) {
        JsonNode v = src.path(field);
        if (v.isTextual() && !v.asText().isBlank()) o.put(field, v.asText());
    }

    /** source 启发式：builtin（opencode.tool.<name> 插件）→ plugin（业务插件工具）→ custom。 */
    private String classifyToolSource(String name, Set<String> pluginIds, Set<String> businessToolNames) {
        if (pluginIds.contains(BUILTIN_TOOL_PLUGIN_PREFIX + name)) return "builtin";
        if (businessToolNames.contains(name)) return "plugin";
        return "custom";
    }

    /**
     * 从业务插件 TS 源码（默认 agents/plugins/a2ui-tools.ts，可用
     * {@code opencode.plugin-tools-file} 覆盖）提取 {@code name: "..."} 工具名。
     * 文件不可读 → 空集 + log.warn（相关工具降级 custom，不阻塞聚合）。
     */
    private Set<String> loadPluginToolNames() {
        Set<String> cached = pluginToolNames;
        if (cached != null) return cached;
        Set<String> names = new TreeSet<>();
        try {
            String src = Files.readString(Path.of(pluginToolsFile));
            Matcher m = TOOL_NAME.matcher(src);
            while (m.find()) names.add(m.group(1));
        } catch (Exception e) {
            log.warn("capabilities: 业务插件工具名清单 {} 不可读（相关工具降级 custom）: {}",
                    pluginToolsFile, e.toString());
        }
        pluginToolNames = names;
        return names;
    }

    private record ToolFetch(List<JsonNode> items, boolean available) {}
}
