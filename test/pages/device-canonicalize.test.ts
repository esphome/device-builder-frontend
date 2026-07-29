/**
 * @vitest-environment happy-dom
 *
 * Pins the legacy-spelling migrate CTA: the whole-file splice applies
 * only when the device and buffer still match what the request was
 * computed against, and every outcome acknowledges the click.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

const LEGACY = "api:\n  services:\n    - service: pause\n      then: []\n";
const CANONICAL = "api:\n  actions:\n    - action: pause\n      then: []\n";
const DIFF = { fromLine: 2, toLine: 3, replacement: "  actions:\n    - action: pause\n" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function makePage(canonicalize: ReturnType<typeof vi.fn>): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  internals(page)._api = { canonicalizeSpellings: canonicalize } as unknown as ESPHomeAPI;
  page.id = "kitchen.yaml";
  internals(page)._yaml = LEGACY;
  internals(page)._savedYaml = LEGACY;
  internals(page)._repinSelection = vi.fn();
  return page;
}

describe("device page — canonicalize CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the splice and announces success", async () => {
    const canonicalize = vi.fn().mockResolvedValue({ yaml_diff: DIFF });
    const page = makePage(canonicalize);
    await internals(page)._onCanonicalize();
    expect(canonicalize).toHaveBeenCalledWith(LEGACY);
    expect(internals(page)._yaml).toBe(CANONICAL);
    expect(toast.success).toHaveBeenCalled();
  });

  it("drops a splice computed against a superseded buffer", async () => {
    let resolve!: (v: unknown) => void;
    const canonicalize = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const page = makePage(canonicalize);
    const pending = internals(page)._onCanonicalize();
    internals(page)._yaml = LEGACY + "# typed mid-flight\n";
    resolve({ yaml_diff: DIFF });
    await pending;
    expect(internals(page)._yaml).toBe(LEGACY + "# typed mid-flight\n");
    expect(toast.info).toHaveBeenCalled();
  });

  it("drops a splice after a device switch, silently", async () => {
    let resolve!: (v: unknown) => void;
    const canonicalize = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const page = makePage(canonicalize);
    const pending = internals(page)._onCanonicalize();
    page.id = "other.yaml";
    resolve({ yaml_diff: DIFF });
    await pending;
    expect(internals(page)._yaml).toBe(LEGACY);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("acknowledges a null diff instead of a dead-end click", async () => {
    const canonicalize = vi.fn().mockResolvedValue({ yaml_diff: null });
    const page = makePage(canonicalize);
    await internals(page)._onCanonicalize();
    expect(internals(page)._yaml).toBe(LEGACY);
    expect(toast.info).toHaveBeenCalled();
  });
});
