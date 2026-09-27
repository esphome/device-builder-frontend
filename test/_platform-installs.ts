import { PLATFORMS } from "../src/platforms/registry.js";

/** Every registered platform's in-browser install flows. */
export const PLATFORM_INSTALLS = PLATFORMS.flatMap((p) => p.installs ?? []);
