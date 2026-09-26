import type { WebLogsPolicy } from "../../logs/logs-policy.js";

/** The nRF52's CDC has no reset line, and ignores the lines otherwise. */
export const NRF_LOGS: WebLogsPolicy = {};
