/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TourTablePageController } from "../../../src/components/dashboard/device-table-tour.js";
import {
  clearTourConfiguration,
  setTourActive,
  setTourConfiguration,
} from "../../../src/components/guided-tour/tour-session.js";

afterEach(() => {
  setTourActive(false);
  clearTourConfiguration();
});

describe("TourTablePageController", () => {
  it("allows the same page request after a cancelled microtask", async () => {
    const setPageIndex = vi.fn();
    const controller = new TourTablePageController(setPageIndex);
    const rows = Array.from({ length: 30 }, (_, index) => ({
      original: { config: `demo-${index}.yaml` },
    }));
    setTourConfiguration("demo-20.yaml");
    setTourActive(true);

    controller.ensureTargetPage(rows, 10, 10, 0);
    setTourActive(false);
    await Promise.resolve();
    expect(setPageIndex).not.toHaveBeenCalled();

    setTourActive(true);
    controller.ensureTargetPage(rows, 10, 10, 0);
    await Promise.resolve();
    expect(setPageIndex).toHaveBeenCalledWith(2);
  });
});
