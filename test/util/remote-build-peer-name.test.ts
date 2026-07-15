import { describe, expect, it } from "vitest";
import { remoteBuildPeerName } from "../../src/util/remote-build-peer-name.js";

describe("remoteBuildPeerName", () => {
  it("labels the HA add-on stable channel", () => {
    expect(remoteBuildPeerName({ friendly_name: "5c53de3b-esphome", name: "x" })).toBe(
      "Home Assistant App"
    );
  });

  it("labels the HA add-on beta and dev channels", () => {
    expect(
      remoteBuildPeerName({ friendly_name: "5c53de3b-esphome-beta", name: "x" })
    ).toBe("Home Assistant App (Beta)");
    expect(
      remoteBuildPeerName({ friendly_name: "5c53de3b-esphome-dev", name: "x" })
    ).toBe("Home Assistant App (Dev)");
  });

  it("recognises any repo-hash prefix, not just one install", () => {
    expect(
      remoteBuildPeerName({ friendly_name: "a1b2c3d4-esphome-dev", name: "x" })
    ).toBe("Home Assistant App (Dev)");
  });

  it("falls back to the ha_addon flag when the hostname isn't the add-on shape", () => {
    expect(
      remoteBuildPeerName({ friendly_name: "hass-box", name: "x", ha_addon: true })
    ).toBe("Home Assistant App");
  });

  it("prefers the friendly name for an ordinary peer", () => {
    expect(remoteBuildPeerName({ friendly_name: "Mac", name: "esphome-builder-x" })).toBe(
      "Mac"
    );
  });

  it("falls back to the instance name and trims a trailing dot", () => {
    expect(remoteBuildPeerName({ friendly_name: "", name: "living-room.local." })).toBe(
      "living-room.local"
    );
  });
});
