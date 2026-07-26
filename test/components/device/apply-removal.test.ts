/**
 * Pins applyRemoval's removed-lines verification: a re-base lands
 * only when it removed the exact lines the delete did; everything
 * else reports null for the conservative fallback.
 */
import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import { applyRemoval } from "../../../src/components/device/apply-removal.js";
import type { YamlUpdatedDetail } from "../../../src/components/device/section-editor.js";

const NO_API = {} as Pick<ESPHomeAPI, "deleteAutomation">;

const componentWrite = (over: Partial<YamlUpdatedDetail> = {}): YamlUpdatedDetail => ({
  configuration: "device.yaml",
  yaml: "logger:\n",
  basedOn: "wifi:\n  ssid: home\nlogger:\n",
  removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
  ...over,
});

describe("applyRemoval verification", () => {
  it("lands a component re-base that removed the same lines", async () => {
    const rebased = await applyRemoval(
      componentWrite(),
      "wifi:\n  ssid: home\nlogger:\n  level: DEBUG\n",
      NO_API
    );

    expect(rebased).toBe("logger:\n  level: DEBUG\n");
  });

  it("rejects a component re-base that would remove different content", async () => {
    // The user re-typed a fresh wifi block during the round trip;
    // splicing it out would silently delete new content.
    const rebased = await applyRemoval(
      componentWrite(),
      "wifi:\n  ssid: other\nlogger:\n  level: DEBUG\n",
      NO_API
    );

    expect(rebased).toBeNull();
  });

  it("rejects when the announced write was not a pure removal", async () => {
    // basedOn -> yaml inserted a line, so there is no removed block
    // to verify against.
    const rebased = await applyRemoval(
      componentWrite({ yaml: "wifi:\n  ssid: home\nlogger:\nweb_server:\n" }),
      "wifi:\n  ssid: home\nlogger:\n  level: DEBUG\n",
      NO_API
    );

    expect(rebased).toBeNull();
  });

  it("rejects a recompute whose diff is not a pure removal", async () => {
    const api = {
      deleteAutomation: vi
        .fn()
        .mockResolvedValue({ yaml_diff: { fromLine: 1, toLine: 1, replacement: "x" } }),
    } as unknown as Pick<ESPHomeAPI, "deleteAutomation">;

    const rebased = await applyRemoval(
      {
        configuration: "device.yaml",
        yaml: "logger:\n",
        basedOn: "logger:\nscript:\n  - id: s1\n",
        removed: { kind: "automation", location: { kind: "script", id: "s1" } },
      },
      "logger:\n  level: DEBUG\nscript:\n  - id: s1\n",
      api
    );

    expect(rebased).toBeNull();
  });

  it("lands an automation re-base whose diff removed the same lines", async () => {
    const api = {
      deleteAutomation: vi
        .fn()
        .mockResolvedValue({ yaml_diff: { fromLine: 3, toLine: 4, replacement: "" } }),
    } as unknown as Pick<ESPHomeAPI, "deleteAutomation">;

    const rebased = await applyRemoval(
      {
        configuration: "device.yaml",
        yaml: "logger:\n",
        basedOn: "logger:\nscript:\n  - id: s1\n",
        removed: { kind: "automation", location: { kind: "script", id: "s1" } },
      },
      "logger:\n  level: DEBUG\nscript:\n  - id: s1\n",
      api
    );

    expect(rebased).toBe("logger:\n  level: DEBUG\n");
  });
});
