import { RTS_PULSE, type WebLogsPolicy } from "../../logs/logs-policy.js";

/**
 * The usual kits wire RTS to CEN and DTR to the PA00 download strap: every
 * logs open drops both lines so the board boots its firmware, and RTS still
 * resets it on demand.
 */
export const RTL_LOGS: WebLogsPolicy = { reset: RTS_PULSE, releaseLines: true };
