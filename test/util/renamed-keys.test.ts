import { afterEach, describe, expect, it } from "vitest";
import {
  _clearRenamedKeys,
  acceptedKeysFor,
  recordRenamedKeys,
  renamedKeysGeneration,
} from "../../src/util/renamed-keys.js";

afterEach(() => _clearRenamedKeys());

describe("renamed-keys registry", () => {
  it("resolves accepted spellings canonical-first, by target key", () => {
    recordRenamedKeys("api", { services: "actions", service: "action" });
    expect(acceptedKeysFor("api", "actions")).toEqual(["actions", "services"]);
    expect(acceptedKeysFor("api", "action")).toEqual(["action", "service"]);
    expect(acceptedKeysFor("api", "port")).toEqual(["port"]);
    expect(acceptedKeysFor("wifi", "actions")).toEqual(["actions"]);
  });

  it("returns a stable cached array until the next record", () => {
    recordRenamedKeys("api", { services: "actions" });
    const first = acceptedKeysFor("api", "actions");
    expect(acceptedKeysFor("api", "actions")).toBe(first);
    recordRenamedKeys("api", { services: "actions", svc: "actions" });
    expect(acceptedKeysFor("api", "actions")).not.toBe(first);
  });

  it("does not bump the generation for an unchanged map", () => {
    recordRenamedKeys("api", { services: "actions" });
    const generation = renamedKeysGeneration();
    recordRenamedKeys("api", { services: "actions" });
    expect(renamedKeysGeneration()).toBe(generation);
    recordRenamedKeys("api", { services: "actions", service: "action" });
    expect(renamedKeysGeneration()).toBe(generation + 1);
  });

  it("ignores absent and empty maps, keeping earlier data", () => {
    recordRenamedKeys("api", { services: "actions" });
    const generation = renamedKeysGeneration();
    recordRenamedKeys("api", undefined);
    recordRenamedKeys("api", {});
    expect(renamedKeysGeneration()).toBe(generation);
    expect(acceptedKeysFor("api", "actions")).toEqual(["actions", "services"]);
  });
});
