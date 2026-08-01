import { describe, expect, it } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { detectInstallation } from "../../src/util/installation.js";

const api = (serverInfo: unknown): ESPHomeAPI => ({ serverInfo }) as ESPHomeAPI;

describe("detectInstallation", () => {
  it("names the HA add-on regardless of server info", () => {
    expect(detectInstallation(api(undefined), true)).toBe("Home Assistant Add-on");
  });

  it("distinguishes Docker from pip via in_docker", () => {
    expect(detectInstallation(api({ in_docker: true }), false)).toBe("Docker");
    expect(detectInstallation(api({ in_docker: false }), false)).toBe("pip");
  });

  it("stays unknown for the desktop app or a pre-in_docker backend", () => {
    expect(detectInstallation(api(undefined), false)).toBe("");
    expect(detectInstallation(api({ desktop_version: "1.0" }), false)).toBe("");
    expect(detectInstallation(api({}), false)).toBe("");
  });
});
