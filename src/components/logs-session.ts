/**
 * State machine for the logs dialog's active session.
 *
 * The dialog drives two unrelated log sources — the backend ``logs`` WS
 * subscription (OTA / server-serial) and a browser Web Serial reader — each
 * with its own start/stop/pause lifecycle. Modelling them as a discriminated
 * union (rather than a handful of independent booleans) makes the illegal
 * combinations that bit us unrepresentable: OTA streaming onto a serial
 * session, a Stop/Start that reopens (and reboots) the device, a second
 * reconnect firing while one is already in flight, an attach landing on a
 * closed dialog.
 *
 * States:
 * - ``idle``         no source (initial / after teardown).
 * - ``ota``          backend WS source; ``streamId`` null means stopped (the
 *                    Start button restarts it), non-null means streaming.
 * - ``reconnecting`` a Web Serial attach/reopen is in flight (no reader yet).
 *                    ``paused`` records a Stop pressed during the wait so the
 *                    landing attach honors it; Start/Stop here only toggle
 *                    ``paused`` — they never start a *second* reconnect.
 * - ``serial``       a Web Serial reader is attached and draining the open
 *                    port. ``paused`` gates the on-screen log (the reader keeps
 *                    draining either way, so resuming needn't reopen the port
 *                    and pulse DTR/RTS — #526).
 * - ``dead``         a Web Serial reopen failed; the port is gone. Start runs
 *                    the reconnect hook (the #636 "click Start to reconnect").
 */
export type LogsSession =
  | { readonly kind: "idle" }
  | { readonly kind: "ota"; readonly port: string; readonly streamId: string | null }
  | { readonly kind: "reconnecting"; readonly paused: boolean }
  | {
      readonly kind: "serial";
      readonly port: SerialPort;
      readonly cancel: () => void;
      readonly paused: boolean;
    }
  | { readonly kind: "dead" };

/** Sentinel ``ota`` port for the network / OTA log source (as opposed to a
 *  server serial device path like ``/dev/cu.usbserial-110``). Both run through
 *  the backend ``logs`` WS subscription and so share the ``ota`` session kind;
 *  the port is what tells them apart. */
export const OTA_PORT = "OTA";

/** Whether the streaming dot / Stop button should show (vs. the Start button). */
export const isStreaming = (s: LogsSession): boolean =>
  (s.kind === "ota" && s.streamId !== null) ||
  ((s.kind === "serial" || s.kind === "reconnecting") && !s.paused);

/** Web Serial session (any phase): drives the source chip + hides the states
 *  toggle, which only applies to the backend ``--no-states`` flag. */
export const isPassive = (s: LogsSession): boolean =>
  s.kind === "serial" || s.kind === "reconnecting" || s.kind === "dead";

/** A live Web Serial port is held — the only state where Reset Device can fire
 *  and the port can be torn down. */
export const hasSerialPort = (s: LogsSession): boolean => s.kind === "serial";

/** Whether the States toggle applies. Device states arrive only over the API /
 *  network connection, so the toggle (which sets the backend ``--no-states``
 *  flag) is meaningful only for the OTA source. Server serial shares the
 *  ``ota`` kind but carries a device path instead of the ``OTA`` sentinel, so
 *  it's excluded — toggling states there is a no-op (#539). */
export const isOtaNetwork = (s: LogsSession): boolean =>
  s.kind === "ota" && s.port === OTA_PORT;
