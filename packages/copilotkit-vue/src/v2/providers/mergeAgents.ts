import type { AbstractAgent } from "@ag-ui/client";

/**
 * FORK ADDITION (@company internal fork of @copilotkit/vue 1.67.1).
 *
 * Merges the three local-agent maps accepted by CopilotKitProvider into the
 * single record handed to CopilotKitCoreVue. Precedence (later wins):
 * agents__unsafe_dev_only < selfManagedAgents < directAgents.
 *
 * `directAgents` is the supported way for this project's business code to
 * register self-hosted AG-UI agents (e.g. an HttpAgent pointing at the Java
 * Spring Boot backend) without touching the dev-only or Enterprise-marked
 * props.
 */
export function mergeAgents(
  agentsUnsafeDevOnly: Record<string, AbstractAgent> = {},
  selfManagedAgents: Record<string, AbstractAgent> = {},
  directAgents: Record<string, AbstractAgent> = {},
): Record<string, AbstractAgent> {
  return {
    ...agentsUnsafeDevOnly,
    ...selfManagedAgents,
    ...directAgents,
  };
}
