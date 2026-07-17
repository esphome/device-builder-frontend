/**
 * The logs dialog's log source and its lifecycle.
 *
 * Every transition of ``host._session`` lives here; the element renders it and
 * owns nothing about how a stream is started, paused, or torn down.
 */
import { notifyError } from "../../util/notify.js";
import type { ESPHomeLogsDialog } from "../logs-dialog.js";
import { isPassive, isStreaming } from "../logs-session.js";

/** Open on a backend OTA / server-serial stream for *port*. */
export function openOta(
  host: ESPHomeLogsDialog,
  port: string,
  options: { onBackToInstall?: () => void } = {}
): void {
  beginSession(host, options.onBackToInstall);
  host._reconnect = null;
  host._session = { kind: "ota", port, streamId: null };
  host._open = true;
  host._resetAnsiLogScroll();
  // Not awaiting the teardown in beginSession (unlike toggleShowStates):
  // openOta is only reached after a close, so any prior session is already
  // idle and the teardown is a no-op — there's no live stream to overlap.
  startOtaStream(host);
}

/** Open for a Web Serial reader the caller attaches via ``setSerialStream``. */
export function openPassive(
  host: ESPHomeLogsDialog,
  options: {
    // Required so the `dead` state (a reopen failure) always has a recovery
    // path — Start re-runs it; otherwise the Start button would be a dead end.
    onReconnect: () => Promise<void>;
    onBackToInstall?: () => void;
  }
): void {
  beginSession(host, options.onBackToInstall);
  host._reconnect = options.onReconnect;
  // The attach (`attachSerialLogStream` -> `setSerialStream`) follows
  // immediately; show it as connecting/streaming until the reader lands.
  host._session = { kind: "reconnecting", paused: false };
  host._open = true;
  host._resetAnsiLogScroll();
}

/** Shared open prologue: tear down any prior session and reset the per-session
 *  view state. ``_showStates`` resets each open so the dialog behaves the same
 *  way every time unless the user flips it this session. */
function beginSession(host: ESPHomeLogsDialog, onBackToInstall?: () => void): void {
  void teardownSession(host);
  host._clearLogs();
  host._expanded = false;
  host._showStates = true;
  host._backToInstallHandler = onBackToInstall ?? null;
  host._backToInstall = host._backToInstallHandler !== null;
}

/** Register the Web Serial reader (its loop-cancel) + port. Called by
 *  `attachSerialLogStream` once a port is open and streaming. */
export function setSerialStream(
  host: ESPHomeLogsDialog,
  port: SerialPort,
  cancel: () => void
): void {
  // The attach is async (the reopen path retries for up to 5s). If the dialog
  // closed or switched to a non-passive session while it was in flight, don't
  // register — tear it down (cancel stops the reader and closes the port) so
  // the handle isn't leaked, leaving the next open to fail "already open".
  if (!host._open || !isPassive(host._session)) {
    cancel();
    return;
  }
  // Honor a Stop pressed during the in-flight attach; replace any prior
  // reader (defensive — `reconnecting` holds none).
  const paused = host._session.kind === "reconnecting" ? host._session.paused : false;
  if (host._session.kind === "serial") host._session.cancel();
  host._session = { kind: "serial", port, cancel, paused };
}

/**
 * Surface a failure to reopen the Web Serial port for post-install logs.
 * Appends the message into the log pane (so a user who looked away during the
 * install still sees the cause) and drops to ``dead`` so the toolbar shows
 * "Start" — clicking it re-runs the reconnect hook. The caller pairs this
 * with a ``toast.error``.
 */
export function setSerialOpenFailed(host: ESPHomeLogsDialog, message: string): void {
  // Same guard as setSerialStream: the reopen retries across the re-enum
  // window, so a late failure can land after the dialog closed or switched to
  // an OTA session — don't tear that unrelated session down or flip it dead.
  if (!host._open || !isPassive(host._session)) return;
  void teardownSession(host);
  host._log.dropPending();
  host._log.append([message]);
  host._session = { kind: "dead" };
}

/**
 * Return an in-flight reconnect to ``dead`` without surfacing an error — for
 * when the user dismisses the Web Serial port picker. The ``Start`` button
 * stays available; no log line or toast (a cancel isn't a failure). Only acts
 * while ``reconnecting`` — never on a live ``serial`` session, which holds an
 * open reader/port that flipping to ``dead`` would leak.
 */
export function abortSerialReconnect(host: ESPHomeLogsDialog): void {
  if (host._session.kind !== "reconnecting") return;
  host._session = { kind: "dead" };
}

/** Stop whatever the session is running (Web Serial reader -> closes the
 *  port; backend WS -> kills the subprocess) and return to ``idle``. The
 *  cancel from `streamSerialToDialog` releases the reader lock before closing
 *  so the next open isn't blocked by a still-open port. A Stop *pause*
 *  doesn't call this — it keeps the reader + port alive (#526). */
export function teardownSession(host: ESPHomeLogsDialog): Promise<void> {
  // Drain any batched lines into the visible buffer before the session ends
  // so a stop/close doesn't drop what was buffered for the next frame.
  host._log.flush();
  const s = host._session;
  host._session = { kind: "idle" };
  if (s.kind === "serial") {
    s.cancel();
    return Promise.resolve();
  }
  if (s.kind === "ota" && s.streamId !== null) {
    return stopBackendStream(host, s.streamId);
  }
  return Promise.resolve();
}

function stopBackendStream(host: ESPHomeLogsDialog, streamId: string): Promise<void> {
  // Swallow errors: if the WS is already gone there's nothing to cancel
  // server-side. Returns a promise so callers that immediately respawn (the
  // states toggle) can await the cancel landing first.
  return host._api
    .stopStream(streamId)
    .catch(() => undefined)
    .then(() => undefined);
}

// Start button (only shown while not streaming; the leading guard also
// absorbs a double-click in the same microtask). Per state:
//  - ota (stopped): respawn the backend stream.
//  - serial / reconnecting: just un-pause display — no port reopen (no
//    DTR/RTS pulse / reset) and no second reconnect while one's in flight.
//  - dead: run the reconnect hook (#636).
export function onStart(host: ESPHomeLogsDialog): void {
  const s = host._session;
  if (isStreaming(s)) return;
  switch (s.kind) {
    case "ota":
      startOtaStream(host);
      break;
    case "serial":
    case "reconnecting":
      host._session = { ...s, paused: false };
      break;
    case "dead":
      reconnectSerial(host);
      break;
  }
}

// Stop button. OTA kills the subprocess (Start respawns it); a Web Serial
// session only pauses display — the port + reader stay open so Start resumes
// without a close/reopen that reboots the device (#526).
export function onStop(host: ESPHomeLogsDialog): void {
  const s = host._session;
  switch (s.kind) {
    case "ota":
      if (s.streamId !== null) {
        host._session = { kind: "ota", port: s.port, streamId: null };
        void stopBackendStream(host, s.streamId);
      }
      break;
    case "serial":
    case "reconnecting":
      host._session = { ...s, paused: true };
      break;
  }
}

export function startOtaStream(host: ESPHomeLogsDialog): void {
  const s = host._session;
  // Don't respawn onto a closed dialog (a close during the states-toggle
  // cancel await would otherwise orphan a stream); only spawn from a stopped
  // OTA session.
  if (!host._open || s.kind !== "ota" || s.streamId !== null) return;
  // Tag the stop callbacks with this stream's id so a late onResult/onError
  // from a torn-down stream can't stop the one that replaced it. (The API
  // also drops a stopped stream's handler synchronously, so this is belt +
  // braces — it keeps correctness local instead of relying on that.)
  let streamId = "";
  streamId = host._api.logs(
    host.configuration,
    s.port,
    {
      onOutput: (line: string) => {
        host._enqueueLine(line);
      },
      onResult: () => markOtaStopped(host, streamId),
      onError: () => markOtaStopped(host, streamId),
    },
    { noStates: !host._showStates }
  );
  host._session = { kind: "ota", port: s.port, streamId };
}

function markOtaStopped(host: ESPHomeLogsDialog, streamId: string): void {
  const s = host._session;
  if (s.kind === "ota" && s.streamId === streamId) {
    host._session = { kind: "ota", port: s.port, streamId: null };
  }
}

function reconnectSerial(host: ESPHomeLogsDialog): void {
  if (!host._reconnect) return;
  host._session = { kind: "reconnecting", paused: false };
  host._reconnect().catch(() => {
    // The reopen-retry failure path handles itself (setSerialOpenFailed ->
    // `dead`, with its own toast). Only surface genuinely-unhandled
    // rejections — still `reconnecting` means attach didn't handle it — so we
    // don't double-toast.
    if (host._session.kind !== "reconnecting") return;
    host._session = { kind: "dead" };
    notifyError(host._localize("dashboard.logs_web_serial_open_failed"));
  });
}

/* The --no-states flag is baked into the esphome subprocess at spawn time,
   so flipping the toggle tears the stream down and respawns it. Await the
   cancel so the backend has killed the old subprocess before the new one
   spawns (a fast double-toggle would otherwise leave two readers on the
   device API). Only while actively streaming — if the user already hit
   Stop, leave the buffer and let them Start themselves. */
export async function toggleShowStates(host: ESPHomeLogsDialog): Promise<void> {
  host._showStates = !host._showStates;
  const s = host._session;
  if (s.kind !== "ota" || s.streamId === null) return;
  host._session = { kind: "ota", port: s.port, streamId: null };
  await stopBackendStream(host, s.streamId);
  startOtaStream(host);
}
