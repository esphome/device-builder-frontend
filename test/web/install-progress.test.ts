// @vitest-environment happy-dom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/components/install-details-log.js", () => ({}));

import { renderInto } from "../_dom.js";
import { renderProgressCard } from "../../src/web/install/install-progress.js";

const localize = (key: string) => key;

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = (root: Element) => root.querySelector("esphome-install-details-log") as any;

describe("renderProgressCard details log", () => {
  it("slots the log only once a line exists", () => {
    expect(
      log(
        renderInto(
          renderProgressCard({ state: "running", message: "m", log: [] }, localize)
        )
      )
    ).toBeNull();
    const el = log(
      renderInto(
        renderProgressCard({ state: "running", message: "m", log: ["a"] }, localize)
      )
    );
    expect(el.lines).toEqual(["a"]);
    expect(el.expanded).toBe(false);
    expect(el.getAttribute("download-name")).toBe("esphome-web-install.txt");
  });

  it("keeps a log the user opened open across progress re-renders", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const paint = (lines: string[], state: "running" | "success" | "error" = "running") =>
      render(
        renderProgressCard({ state, message: "m", log: lines }, localize),
        container
      );
    paint(["a"]);
    const el = log(container);
    // The user opens it while the flash runs.
    el.expanded = true;
    // Later lines re-render the card with the same binding value: no reset.
    paint(["a", "b"]);
    expect(log(container)).toBe(el);
    expect(el.expanded).toBe(true);
    paint(["a", "b"], "success");
    expect(el.expanded).toBe(true);
  });

  it("opens the log on failure so the failing step is in view", () => {
    const el = log(
      renderInto(
        renderProgressCard({ state: "error", message: "m", log: ["a"] }, localize)
      )
    );
    expect(el.expanded).toBe(true);
  });
});

describe("renderProgressCard keep-visible note", () => {
  const detail = (card: Parameters<typeof renderProgressCard>[0]) =>
    (
      renderInto(renderProgressCard(card, localize)).querySelector(
        "esphome-process-terminal"
      ) as any
    ).statusDetail;

  it("asks the user to keep the window visible while a write shows progress", () => {
    expect(detail({ state: "running", message: "m", progress: 0 })).toBe(
      "firmware.flashing_keep_visible"
    );
  });

  it("leaves a step's own detail and a step without progress alone", () => {
    expect(detail({ state: "running", message: "m", progress: 40, detail: "d" })).toBe(
      "d"
    );
    expect(detail({ state: "running", message: "m" })).toBe("");
  });
});
