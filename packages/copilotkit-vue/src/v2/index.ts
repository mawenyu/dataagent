// Re-export core (framework-agnostic)
export * from "@copilotkit/core";
export * from "@ag-ui/client";

// Local V2 vue code
export * from "./components";
// Explicit re-export so the default A2UI catalog is reachable as a public
// named export. Vue users need a catalog to pass to `a2ui.catalog` for the
// catalog-on-provider path; the nested `export *` barrel above gets
// tree-shaken by the library build, so surface it directly here.
export { vueBasicCatalog } from "./components/a2ui/catalog";
// FORK ADDITION: expose the A2UI component adapter so the app can register
// whitelisted custom catalog components (DataAgent catalog, TASK §15).
// Upstream never surfaces these (the "./a2ui" barrel resolves to a2ui.ts,
// shadowing the a2ui/ directory index).
export {
  createVueComponent,
  createBinderlessVueComponent,
} from "./components/a2ui/adapter";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/vue-core";
export * from "./lib/processPartialHtml";
