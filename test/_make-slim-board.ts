import type { SlimBoard } from "../src/api/types/boards.js";

/** Shared ``SlimBoard`` fixture; override the fields under test. */
export function makeSlimBoard(
  id: string,
  esphome: Partial<SlimBoard["esphome"]> = {}
): SlimBoard {
  return {
    id,
    name: id,
    manufacturer: "",
    images: [],
    esphome: { platform: "esp32", board: id, variant: null, ...esphome },
  } as unknown as SlimBoard;
}
