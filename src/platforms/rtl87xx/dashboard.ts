/** The Device Builder's RTL8720C support: the ROM downloader over the board's serial adapter, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { loadAmbz2Engine } from "./index.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";
import { RTL87XX_SERIAL_LOGS } from "./serial-logs.js";

export * from "./ambz2-install.js";

/** Link the ROM downloader over DTR/RTS, as a flash starts, and stop there. */
async function probeRtl8720c(port: SerialPort): Promise<string | null> {
  const engine = await loadAmbz2Engine().catch((err: unknown) => {
    console.warn("[rtl87xx] Could not load the engine chunk for the probe:", err);
    return null;
  });
  if (!engine) return null;
  const found = await engine.probeAmbz2(port, {
    onLog: (line) => console.debug(`[rtl87xx probe] ${line}`),
  });
  return found ? "rtl8720c" : null;
}

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  install: rtlAmbz2Install,
  logs: { serial: RTL87XX_SERIAL_LOGS },
  probeBridgePort: probeRtl8720c,
};
