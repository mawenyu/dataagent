# Internal fork: @copilotkit/vue 1.67.1 + `directAgents`

**Base**: upstream `CopilotKit/CopilotKit` tag `v1.67.1`
(git tag object `9228710232c47f0795e6da9e2d3c6df126be26cf`), `packages/vue` only.
Upstream license (MIT, Copyright (c) Atai Barkai) is preserved in `LICENSE`.

## Why this fork exists

Project red lines forbid a Node.js CopilotKit Runtime, `runtimeUrl`, Copilot
Cloud, and business code touching `agents__unsafe_dev_only` or the
Enterprise-marked `selfManagedAgents`. The Vue app must register a local
`HttpAgent` (pointing at the Java Spring Boot backend) under a supported prop.

## Complete diff vs upstream v1.67.1

1. `src/v2/providers/CopilotKitProvider.types.ts`
   - `CopilotKitProviderProps` gains `directAgents?: Record<string, AbstractAgent>`.
2. `src/v2/providers/CopilotKitProvider.vue`
   - `withDefaults` gains `directAgents: () => ({})`.
   - `mergedAgents` now delegates to `mergeAgents(...)`, i.e.
     `{ ...agents__unsafe_dev_only, ...selfManagedAgents, ...directAgents }`.
   - added `import { mergeAgents } from "./mergeAgents"`.
3. `src/v2/providers/mergeAgents.ts` (new) — pure merge helper.
4. `src/v2/providers/__tests__/CopilotKitProvider.directAgents.test.ts` (new).
5. `src/v2/index.ts` — explicit re-export of `createVueComponent` /
   `createBinderlessVueComponent` from `./components/a2ui/adapter` (upstream
   never surfaces them: the `./a2ui` barrel resolves to `a2ui.ts`, shadowing
   the `a2ui/` directory). Needed so the app can register whitelisted custom
   A2UI catalog components (TASK §15).
6. `src/v2/hooks/use-agent.ts` — `resolveAgent` unwraps the core-registry
   agent with `toRaw()` before per-thread cloning. Without it, the registry's
   Vue-reactive wrapper makes `AbstractAgent.clone()`'s `structuredClone(this.
   messages)` throw `DataCloneError`, breaking any `threadId`-scoped
   CopilotChat (direct-agent multi-session setups).
7. `src/v2/hooks/index.ts` — re-export `getThreadClone` so direct-agent apps
   can write loaded history into the per-thread clone that CopilotChat renders.
8. Packaging only (not shipped to npm): `package.json` name stays
   `@copilotkit/vue`, version `1.67.1-fork.1`, `workspace:*` deps rewritten to
   pinned published versions, devDeps trimmed; `tsconfig.json` inlined
   (`@copilotkit/typescript-config` removed).

No other source file is modified. Because `hasLocalAgents` derives from
`mergedAgents`, a provider with only `directAgents` (no `runtimeUrl`, no
publicApiKey) does not trigger the missing-config error.

## Upgrade procedure

1. Sparse-checkout the new upstream tag's `packages/vue` over `src/`
   (discard local changes).
2. Re-apply the 4 changes above (or `git diff` this dir against the tag and
   re-apply the patch).
3. Bump dependency pins to the versions published with that tag.
4. `npm install && npm run build && npm test -- directAgents`.

## Build / test

```bash
npm install
npm run build     # vite build + tailwind css + vue-tsc types
npm test -- directAgents
```
