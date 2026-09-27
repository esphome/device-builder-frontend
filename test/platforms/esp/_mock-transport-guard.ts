import { vi } from "vitest";

// The session guard has its own tests; the connect suites use bare fakes
// that have no streams to guard.
vi.mock("../../../src/platforms/esp/transport-guard.js", () => ({
  guardTransport: vi.fn(),
  releaseTransportGuard: vi.fn(),
}));
