/**
 * Test helpers for the Vue A2UI basic catalog.
 *
 * Builds a real SurfaceModel (no mocks of the core binding path) and mounts
 * the real A2uiSurface so tests exercise the same render pipeline as prod.
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import {
  SurfaceModel,
  ComponentModel,
} from "@a2ui/web_core/v0_9";
import { A2uiSurface } from "../VueSurface";
import { vueBasicCatalog } from "../catalog";
import type { VueComponentImplementation } from "../adapter";

export interface TestComponentSpec {
  component: string;
  id: string;
  [prop: string]: unknown;
}

export function mountSurface(components: TestComponentSpec[]): {
  wrapper: VueWrapper;
  surface: SurfaceModel<VueComponentImplementation>;
} {
  const surface = new SurfaceModel("test-surface", vueBasicCatalog);
  for (const spec of components) {
    const { component, id, ...props } = spec;
    surface.componentsModel.addComponent(
      new ComponentModel(id, component, props),
    );
  }
  const wrapper = mount(A2uiSurface, { props: { surface } });
  return { wrapper, surface };
}
