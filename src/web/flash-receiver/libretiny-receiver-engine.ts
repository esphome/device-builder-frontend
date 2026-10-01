/**
 * The flash receiver's engine for a LibreTiny chip: the UF2 handed over as
 * one part is parsed here and written through the chip's downloader, by the
 * same ``LibreTinyInstall`` the family's web dialog uses.
 */
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import type { LibreTinyInstall } from "../install/libretiny-install-dialog.js";
import { parseFailureCopy } from "../install/preparation.js";
import { type ReceiverEngine, singleWholePart } from "./receiver-engine.js";
import { serialRun } from "./serial-run.js";

export function libretinyReceiverEngine(
  install: LibreTinyInstall,
  logs: SerialLogsPolicy
): ReceiverEngine {
  const { copy } = install;
  return {
    logs,
    async prepare(parts, _erase, localize, logsAt) {
      const uf2 = singleWholePart(parts);
      const parsed = uf2
        ? await install.load(uf2)
        : { key: copy.badFile, detail: "not a single UF2 part" };
      if ("key" in parsed) {
        // The parser is a chunk of its own; the same bytes can parse next time.
        const { key, retryable } = parseFailureCopy(parsed.key);
        return { error: `${localize(key)} (${parsed.detail})`, retryable };
      }
      const { image } = parsed;
      // Started with the parse so a fetch costs nothing later; ``run`` fetches
      // the same chunk and names a fetch that failed.
      void install.loadEngine().catch(() => {});
      const guide = { url: install.guideUrl, label: localize(copy.guideLink) };
      return {
        run: serialRun(localize, async (port, hooks) => {
          hooks.onState("connecting", localize(copy.connecting));
          const result = await install.run(port, image, {
            onLog: hooks.onLog,
            onProgress: hooks.onProgress,
            onWaiting: () =>
              hooks.onWaiting({ message: localize(copy.waitDetail), guide }),
            onLinked: () =>
              hooks.onState("installing", localize("firmware.status_flashing")),
          });
          if ("detail" in result) {
            hooks.onState(
              "error",
              `${localize(result.key ?? copy.failed)}: ${connectFailureDetail(result.error, localize, () => result.detail)}`
            );
            return null;
          }
          // Without control lines the board is still sitting in its downloader,
          // which is said as the dialog says it.
          const byHand = result.rebooted
            ? undefined
            : (copy.doneByHand ?? "web.install.done_reset_by_hand");
          // A device without serial logs has none to open nor point at.
          if (logsAt === "off") {
            return {
              logsElsewhere: true,
              note: byHand ? { message: localize(byHand) } : undefined,
            };
          }
          if (copy.logsElsewhere && logsAt !== "flash-port") {
            // A reset that is left to do comes before where the logs are.
            const elsewhere = localize(copy.logsElsewhere);
            return {
              logsElsewhere: true,
              note: {
                message: byHand ? `${localize(byHand)} ${elsewhere}` : elsewhere,
              },
            };
          }
          return {
            rebooted: result.rebooted,
            note: byHand ? { message: localize(byHand) } : undefined,
          };
        }),
      };
    },
  };
}
