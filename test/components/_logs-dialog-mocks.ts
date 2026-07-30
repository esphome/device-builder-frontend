// Mocks for the logs-dialog test family. The vi.mock calls run when
// this module is evaluated, so it must be imported (directly or via
// _logs-dialog-env.js) before anything that pulls in the component
// tree.
import { vi } from "vitest";
import "../_mock-webawesome.js";

/** Captures dashboard error toasts for assertion. */
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

export { toastError };
