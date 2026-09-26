/** The Device Builder's RTL8720C support: the ROM downloader over the board's serial adapter, and logs. */
import { withDeadline } from "../../util/with-deadline.js";
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { loadAmbz2Engine } from "./index.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";
import { RTL87XX_SERIAL_LOGS } from "./serial-logs.js";

export * from "./ambz2-install.js";

/**
 * The probe's whole budget: one reset and link takes about three seconds,
 * and the teardown a fraction of that. Past it the session is aborted, which
 * unwinds its reads; a ``setSignals`` or ``close`` that never returns (the
 * hang #1858 guards esptool against) gets a little longer, then the probe is
 * given up like esptool's release is.
 */
const PROBE_DEADLINE_MS = 10_000;
const PROBE_GRACE_MS = 5_000;

/** Link the ROM downloader over DTR/RTS, as a flash starts, and stop there. */
async function probeRtl8720c(port: SerialPort): Promise<string | null> {
  const engine = await loadAmbz2Engine().catch((err: unknown) => {
    console.warn("[rtl87xx] Could not load the engine chunk for the probe:", err);
    return null;
  });
  if (!engine) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_DEADLINE_MS);
  try {
    const found = await withDeadline(
      engine.probeAmbz2(port, {
        signal: abort.signal,
        onLog: (line) => console.debug(`[rtl87xx probe] ${line}`),
      }),
      PROBE_DEADLINE_MS + PROBE_GRACE_MS,
      () =>
        new Error(`RTL8720C probe not done in ${PROBE_DEADLINE_MS + PROBE_GRACE_MS} ms`)
    );
    return found ? "rtl8720c" : null;
  } catch (err) {
    console.warn(
      "[rtl87xx] Gave up on the probe; the port stays held until the board is unplugged:",
      err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  install: rtlAmbz2Install,
  logs: { serial: RTL87XX_SERIAL_LOGS },
  probeBridgePort: probeRtl8720c,
};
