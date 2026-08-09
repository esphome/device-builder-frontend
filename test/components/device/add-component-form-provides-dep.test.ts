/**
 * @vitest-environment happy-dom
 *
 * Pins the provides-aware dependency gate: a dep the literal-name scan
 * flags missing is cleared once a present top-level component provides it
 * (a `bk72xx:` block provides `libretiny`, satisfying `libretiny_pwm`), so
 * the banner clears and Submit enables without the user adding anything.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { flushMicrotasks } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import type { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import {
  depsBanner,
  makeAddComponentForm,
  mountAddComponentForm,
  submitButton,
} from "./_add-component-form-host.js";

function providersResponse(ids: string[]) {
  return {
    components: ids.map((id) => ({ id }) as ComponentCatalogEntry),
    categories: [],
    total: ids.length,
    offset: 0,
    limit: 200,
  };
}

const bk72xxBoard = {
  id: "generic-bk7231t",
  esphome: { platform: "bk72xx" },
  pins: [],
} as unknown as BoardCatalogEntry;

const libretinyPwm = makeComponentEntry("output.libretiny_pwm", {
  name: "LibreTiny PWM Output",
  dependencies: ["libretiny"],
});

function mountForm(
  getComponents: ReturnType<typeof vi.fn>,
  yaml: string
): Promise<ESPHomeAddComponentForm> {
  return mountAddComponentForm({
    component: libretinyPwm,
    board: bk72xxBoard,
    yaml,
    api: { getComponents } as unknown as ESPHomeAPI,
  });
}

describe("add-component-form provides-satisfied dependency", () => {
  afterEach(() => {
    _clearComponentCache();
    _clearProvidesCache();
    // Restore the console.warn spy even if a test throws before its own restore.
    vi.restoreAllMocks();
  });

  it("clears the missing-deps banner when the board platform provides the dep", async () => {
    const getComponents = vi.fn().mockResolvedValue(providersResponse(["bk72xx"]));
    const el = await mountForm(getComponents, "bk72xx:\n");

    expect(getComponents).toHaveBeenCalledWith(
      expect.objectContaining({ provides: "libretiny" })
    );
    expect(depsBanner(el)).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
  });

  it("keeps blocking when no present component provides the dep", async () => {
    // The board is esp32-like here: nothing in the YAML provides libretiny.
    const getComponents = vi.fn().mockResolvedValue(providersResponse(["bk72xx"]));
    const el = await mountForm(getComponents, "esp32:\n");

    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);
  });

  it("fails closed and warns when the provides lookup rejects", async () => {
    // A WS hiccup on the lookup must leave the dep flagged (banner stays,
    // submit disabled) and surface a warning rather than swallow it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getComponents = vi.fn().mockRejectedValue(new Error("ws down"));
    const el = await mountForm(getComponents, "bk72xx:\n");

    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[add-component-form] provides lookup failed",
      expect.any(Error)
    );
  });

  it("discards a stale in-flight lookup after the form is retargeted", async () => {
    // Resolution A is in flight when the component is retargeted to a dep-free
    // one (which re-runs the resolver, bumps the seq, and early-returns). A's
    // late result must not be written back against the new component.
    let resolveA!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveA = r;
    });
    const getComponents = vi.fn().mockReturnValue(pending);
    const el = makeAddComponentForm({
      component: libretinyPwm,
      board: bk72xxBoard,
      yaml: "bk72xx:\n",
      api: { getComponents } as unknown as ESPHomeAPI,
    });
    document.body.appendChild(el);
    await el.updateComplete; // resolution A kicked off, awaiting getComponents

    // Retarget to a dep-free component: the re-resolve bumps the seq.
    el.component = makeComponentEntry("sensor.template", { name: "Template" });
    await el.updateComplete;

    // A finally resolves with libretiny providers, after the seq moved on.
    resolveA(providersResponse(["bk72xx"]));
    await flushMicrotasks(10);
    await el.updateComplete;

    const inst = el as unknown as { _providedDeps: ReadonlySet<string> };
    expect(inst._providedDeps.size).toBe(0); // stale result discarded
  });

  it("does not re-render on the not-provided path (empty stays empty)", async () => {
    // The provider (bk72xx) isn't present, so resolution yields an empty set.
    // `_providedDeps` is already empty, so it must not be reassigned — a fresh
    // empty Set would only flip identity and force an identical re-render on
    // every YAML change.
    const getComponents = vi.fn().mockResolvedValue(providersResponse(["bk72xx"]));
    const el = makeAddComponentForm({
      component: libretinyPwm,
      board: bk72xxBoard,
      yaml: "esp32:\n",
      api: { getComponents } as unknown as ESPHomeAPI,
    });

    let renders = 0;
    const inst = el as unknown as {
      render: () => unknown;
      _providedDeps: ReadonlySet<string>;
    };
    const origRender = inst.render.bind(el);
    inst.render = () => {
      renders++;
      return origRender();
    };

    document.body.appendChild(el);
    await el.updateComplete;
    const rendersAfterPaint = renders;
    const providedRef = inst._providedDeps;

    // Let the provides lookup settle.
    await flushMicrotasks(10);
    await el.updateComplete;

    expect(getComponents).toHaveBeenCalled(); // the lookup did run
    expect(renders).toBe(rendersAfterPaint); // …but produced no extra render
    expect(inst._providedDeps).toBe(providedRef); // same Set, never reassigned
    expect(depsBanner(el)).not.toBeNull(); // and the dep is still correctly flagged
  });
});
