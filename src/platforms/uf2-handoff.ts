/**
 * The hand-off every UF2 family shares: the build's UF2 handed whole to a
 * web.esphome.io flasher that erases as it writes, parsed here first so a
 * build that is not this flasher's is named before the tab opens. Only the
 * install modules import this; ``handoff.ts`` is the receiver's too and
 * stays free of it.
 */
import type { FirmwareBinary } from "../api/types/firmware-jobs.js";
import type { HandoffFlasher, HandoffRefusal, HandoffSpec } from "./handoff.js";

/** The build's UF2, the artifact the Pico and LibreTiny flows take. */
export const pickUf2 = (binaries: FirmwareBinary[]): FirmwareBinary | undefined =>
  binaries.find((b) => b.type === "uf2");

/** The copy for a build without a UF2. */
export const NO_UF2_KEY = "firmware.no_uf2";

/** What a never-throws parse comes to: a refusal marked by ``key``, or its value. */
type Parsed = HandoffRefusal | { key?: never; [field: string]: unknown };

/**
 * ``check`` from a parse that never throws: the refusal it named, or null for
 * an image. Takes the sync Pico parse and the async lazy-chunk loaders alike.
 */
export function refusalOf(
  load: (bytes: Uint8Array) => Parsed | Promise<Parsed>
): NonNullable<HandoffSpec["check"]> {
  return async (bytes) => {
    const parsed = await load(bytes);
    return parsed.key === undefined ? null : parsed;
  };
}

/** A UF2 family's hand-off; ``logs`` only for a family that knows where its logs are. */
export function uf2Handoff(
  flasher: HandoffFlasher,
  check: NonNullable<HandoffSpec["check"]>,
  logs?: HandoffSpec["logs"]
): HandoffSpec {
  return {
    flasher,
    erase: false,
    pick: pickUf2,
    noArtifactKey: NO_UF2_KEY,
    check,
    ...(logs && { logs }),
  };
}
