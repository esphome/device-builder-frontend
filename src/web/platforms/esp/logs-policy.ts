import { RTS_PULSE, type WebLogsPolicy } from "../../logs/logs-policy.js";

/**
 * ESP boards reset over the auto-reset circuit (RTS), and keep the lines as
 * opened: a change is read as a reset.
 */
export const ESP_LOGS: WebLogsPolicy = { reset: RTS_PULSE };
