/**
 * The LibreTiny UF2 families of the Beken chips. Kept apart from the chip
 * tables so the API in ``index.ts`` can name them without those.
 */
import type { BekenChip } from "./beken-chips.js";

/** A LibreTiny UF2 family and the chips its image runs on. */
export interface BekenFamily {
  id: number;
  name: string;
  chips: readonly BekenChip[];
}

export const BEKEN_FAMILIES: readonly BekenFamily[] = [
  { id: 0x7b3ef230, name: "BK7231N", chips: ["BK7231N"] },
  { id: 0x675a40b0, name: "BK7231T", chips: ["BK7231T", "BK7231U"] },
  { id: 0xafe81d49, name: "BK7231Q", chips: ["BK7231Q"] },
  { id: 0x159ac324, name: "BK7238", chips: ["BK7238"] },
  { id: 0x6a82cc42, name: "BK7251", chips: ["BK7252"] },
];

export const familyOf = (id: number): BekenFamily | undefined =>
  BEKEN_FAMILIES.find((f) => f.id === id);

/** The family whose image runs on ``chip``. */
export const familyOfChip = (chip: BekenChip): BekenFamily | undefined =>
  BEKEN_FAMILIES.find((f) => f.chips.includes(chip));
