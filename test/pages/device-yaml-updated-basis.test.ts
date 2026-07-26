/**
 * @vitest-environment happy-dom
 *
 * Pins the yaml-updated supersede check: a disk write computed
 * against a buffer the pane has moved past (a delete landing after a
 * newer draft) advances only the saved side, so the newer draft is
 * neither clobbered nor silently marked clean (#1476).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import toast from "sonner-js";

import { ESPHomePageDevice } from "../../src/pages/device.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

const updated = (page: ESPHomePageDevice, detail: { yaml: string; basedOn: string }) =>
  internals(page)._onYamlUpdated(new CustomEvent("yaml-updated", { detail }));

describe("yaml-updated supersede check", () => {
  beforeEach(() => {
    vi.mocked(toast.info).mockClear();
  });

  it("advances both sides when the write's basis is the live buffer", () => {
    const page = new ESPHomePageDevice();
    internals(page)._yaml = "a:\n";
    internals(page)._savedYaml = "a:\n";

    updated(page, { yaml: "b:\n", basedOn: "a:\n" });

    expect(internals(page)._yaml).toBe("b:\n");
    expect(internals(page)._savedYaml).toBe("b:\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("advances only the saved side when the buffer moved past the basis", () => {
    const page = new ESPHomePageDevice();
    // A newer draft landed while the delete round trip was out.
    internals(page)._yaml = "draft:\n";
    internals(page)._savedYaml = "a:\n";

    updated(page, { yaml: "b:\n", basedOn: "a:\n" });

    // The pane keeps what the user sees; the page shows honestly
    // dirty against the disk truth.
    expect(internals(page)._yaml).toBe("draft:\n");
    expect(internals(page)._savedYaml).toBe("b:\n");
    // The toast is the whole user-visible mitigation for the
    // retained-buffer divergence.
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
});
