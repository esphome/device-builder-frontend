import { PLATFORMS } from "../src/platforms/registry.js";

/** Every registered platform's in-browser install flow. */
export const PLATFORM_INSTALLS = PLATFORMS.flatMap((p) => (p.install ? [p.install] : []));
