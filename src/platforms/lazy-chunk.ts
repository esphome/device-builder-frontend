/**
 * The never-throws wrappers a platform's ``index.ts`` exports over a chunk
 * fetched on demand: a parse whose failure names its copy, and a flash whose
 * failure comes back as its detail. A chunk that could not be fetched is
 * logged and named ``firmware.engine_load_failed`` here, once for all.
 */
import { getErrorMessage } from "../util/error-message.js";

/** Why a file could not be parsed: the copy for the user and the detail. */
export interface ChunkParseFailure<Key extends string> {
  key: Key | "firmware.engine_load_failed";
  detail: string;
}

/** What ended a flash: its detail, the error, and the ``key`` a family adds where it has copy of its own. */
export type ChunkFlashFailure<Keyed extends { key?: string }> =
  | ({ detail: string; error: unknown } & Keyed)
  | { detail: string; error: unknown; key: "firmware.engine_load_failed" };

/**
 * ``parse`` with the parser chunk, sync or async; what it threw is named by
 * ``keyOf``, which gets the loaded chunk so it can test the chunk's own
 * error classes. Never throws.
 */
export async function parseWith<Chunk, Done, Key extends string>(
  tag: string,
  loadChunk: () => Promise<Chunk>,
  parse: (chunk: Chunk) => Done,
  keyOf: (chunk: Chunk, err: unknown) => Key
): Promise<Awaited<Done> | ChunkParseFailure<Key>> {
  let chunk: Chunk;
  try {
    chunk = await loadChunk();
  } catch (err) {
    console.error(`${tag} Could not load the parser chunk:`, err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return await parse(chunk);
  } catch (err) {
    return { key: keyOf(chunk, err), detail: getErrorMessage(err) };
  }
}

/**
 * ``flash`` with the engine chunk; what it threw comes back as its detail
 * and the error, plus whatever ``keyed`` returns for it: a family with copy
 * of its own names it there, one without returns nothing. Never throws.
 */
export async function flashWith<Chunk, Done, Keyed extends { key?: string }>(
  tag: string,
  loadChunk: () => Promise<Chunk>,
  flash: (chunk: Chunk) => Done,
  keyed: (chunk: Chunk, err: unknown) => Keyed
): Promise<Awaited<Done> | ChunkFlashFailure<Keyed>> {
  let chunk: Chunk;
  try {
    chunk = await loadChunk();
  } catch (err) {
    console.error(`${tag} Could not load the engine chunk:`, err);
    return {
      detail: getErrorMessage(err),
      error: err,
      key: "firmware.engine_load_failed",
    };
  }
  try {
    return await flash(chunk);
  } catch (err) {
    return { detail: getErrorMessage(err), error: err, ...keyed(chunk, err) };
  }
}
