// @vitest-environment happy-dom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

import { renderOffloadHintSlot as commandSlot } from "../../../src/components/command-dialog/renderers.js";
import { renderOffloadHintSlot as installSlot } from "../../../src/components/firmware-install-dialog/renderers.js";
import { SdkDownloadWatch } from "../../../src/components/process-terminal/sdk-download-hint.js";

function watch() {
  const host = { addController: vi.fn(), requestUpdate: vi.fn() };
  return { host, watch: new SdkDownloadWatch(host as never) };
}

describe("SdkDownloadWatch", () => {
  it("is active from the SDK download until the build starts", () => {
    const { host, watch: w } = watch();
    w.observe(
      ["INFO ESPHome 2026.10.0", "INFO Initializing nRF Connect SDK v2.9.2 ..."],
      0
    );
    expect(w.active).toBe(true);
    w.observe(["=== updating zephyr", "--- bsim: fetching"], 2);
    expect(w.active).toBe(true);
    w.observe(["INFO Compiling app... Build path: /x"], 4);
    expect(w.active).toBe(false);
    // One update per change, not per batch
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
  });

  it("picks up a resumed download too", () => {
    const { watch: w } = watch();
    w.observe(["INFO Resuming the nRF Connect SDK v2.9.2 download ..."], 0);
    expect(w.active).toBe(true);
  });

  it("starts over on a new run (an append at stream position 0)", () => {
    const { watch: w } = watch();
    w.observe(["INFO Initializing nRF Connect SDK v2.9.2 ..."], 0);
    w.observe(["INFO ESPHome 2026.10.0"], 0);
    expect(w.active).toBe(false);
  });

  it("stays quiet on an ordinary build", () => {
    const { host, watch: w } = watch();
    w.observe(["INFO Reading configuration", "INFO Compiling app..."], 0);
    expect(w.active).toBe(false);
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });
});

describe("the compile hint slot", () => {
  const text = (result: unknown) => {
    const el = document.createElement("div");
    render(result, el);
    return el.textContent?.trim() ?? "";
  };
  const host = (active: boolean) => ({
    _localize: (k: string) => k,
    _timer: { isCompiling: true, compileElapsedMs: 0 },
    _sdkDownload: { active },
    _jobSource: "local",
    _jobs: new Map(),
    _pairings: null,
  });

  it.each([
    ["command dialog", commandSlot],
    ["install dialog", installSlot],
  ])("shows the SDK download hint in the %s while it runs", (_name, slot) => {
    expect(text(slot(host(true) as never))).toBe("command.sdk_download_hint");
    // An ordinary compile under the offload threshold shows nothing.
    expect(text(slot(host(false) as never))).toBe("");
  });
});
