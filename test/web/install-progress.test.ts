// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/components/install-details-log.js", () => ({}));

import { renderInto } from "../_dom.js";
import { renderProgressCard } from "../../src/web/install/install-progress.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = (root: Element) => root.querySelector("esphome-install-details-log") as any;

describe("renderProgressCard details log", () => {
  it("slots the log only once a line exists", () => {
    expect(
      log(renderInto(renderProgressCard({ state: "running", message: "m", log: [] })))
    ).toBeNull();
    const el = log(
      renderInto(renderProgressCard({ state: "running", message: "m", log: ["a"] }))
    );
    expect(el.lines).toEqual(["a"]);
    expect(el.expanded).toBe(false);
    expect(el.getAttribute("download-name")).toBe("esphome-web-install.txt");
  });

  it("opens the log on failure so the failing step is in view", () => {
    const el = log(
      renderInto(renderProgressCard({ state: "error", message: "m", log: ["a"] }))
    );
    expect(el.expanded).toBe(true);
  });
});
