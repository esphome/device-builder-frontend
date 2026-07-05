import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: {
    error: vi.fn(() => "error-id"),
    info: vi.fn(() => "info-id"),
    success: vi.fn(() => "success-id"),
    warning: vi.fn(() => "warning-id"),
  },
}));

import toast from "sonner-js";
import {
  notify,
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
} from "../../src/util/notify.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("notify wrappers", () => {
  it.each([
    ["error", notifyError, toast.error] as const,
    ["info", notifyInfo, toast.info] as const,
    ["success", notifySuccess, toast.success] as const,
    ["warning", notifyWarning, toast.warning] as const,
  ])("notify %s defaults richColors and forwards the id", (level, wrapper, method) => {
    const id = wrapper("hello");
    expect(method).toHaveBeenCalledWith("hello", { richColors: true });
    expect(id).toBe(`${level}-id`);
  });

  it("passes through the remaining sonner options", () => {
    const onClick = () => undefined;
    notifyError("boom", {
      description: "details",
      duration: 8000,
      id: "stable-id",
      action: { label: "Retry", onClick },
    });
    expect(toast.error).toHaveBeenCalledWith("boom", {
      richColors: true,
      description: "details",
      duration: 8000,
      id: "stable-id",
      action: { label: "Retry", onClick },
    });
  });

  it("lets an explicit richColors override the default", () => {
    notifyInfo("plain", { richColors: false });
    expect(toast.info).toHaveBeenCalledWith("plain", { richColors: false });
  });

  it("dispatches by level through the notify map", () => {
    notify.warning("careful");
    expect(toast.warning).toHaveBeenCalledWith("careful", { richColors: true });
  });
});
