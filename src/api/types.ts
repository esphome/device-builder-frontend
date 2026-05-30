/**
 * Types for the ESPHome Device Builder API.
 *
 * Matches the WebSocket-only backend at /ws.
 * All communication uses a single multiplexed WebSocket with
 * command/message_id/args → result/error/event protocol.
 */

export * from "./types/automations.js";
export * from "./types/boards.js";
export * from "./types/components.js";
export * from "./types/config-entries.js";
export * from "./types/devices.js";
export * from "./types/editor.js";
export * from "./types/event-subscription.js";
export * from "./types/firmware-jobs.js";
export * from "./types/protocol.js";
export * from "./types/reachability.js";
export * from "./types/remote-build-events.js";
export * from "./types/remote-build.js";
export * from "./types/streaming.js";
export * from "./types/system.js";
