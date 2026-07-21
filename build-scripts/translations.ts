// Sync frontend translations with Lokalise.
//
//   pnpm run translations:upload [--cleanup]   push en.json to Lokalise
//   pnpm run translations:download                pull translated locales from Lokalise
//   pnpm run translations:download --source release
//                                                pull locales from the latest GitHub release
//   pnpm run translations:orphans                 export keys on Lokalise but not in en.json
//   pnpm run translations:orphans:delete [--yes]
//                                                delete the reviewed orphan keys from Lokalise
//
// `orphans` is a reviewable alternative to `upload --cleanup`: instead of
// letting Lokalise blindly delete every key absent from en.json, it writes
// the orphan list to translation-orphans.json so a human can prune the ones
// to keep, then `orphans:delete --yes` deletes whatever's left.
//
// The base language (en.json) is the in-repo source of truth: `upload`
// pushes its keys to Lokalise, adding new keys and updating the English
// copy of existing keys (other locales are untouched); `download` writes
// every other locale back into src/translations/ and never touches en.json.
//
// `download --source release` needs no Lokalise token: it reads the
// `translations.zip` asset the release workflow attaches to the latest
// GitHub release, so a build can ship the same locales the last release
// shipped without hitting Lokalise.
//
// Credentials come from the environment:
//   LOKALISE_API_TOKEN   API token with read/write file permissions
//   LOKALISE_PROJECT_ID  target project id
//   GITHUB_TOKEN         optional; raises the rate limit / allows private
//                        access for `download --source release`
//   GITHUB_REPOSITORY    owner/name to read releases from for
//                        `download --source release` (default
//                        esphome/device-builder-frontend)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

import {
  BASE_LANGUAGE,
  findOrphans,
  flattenKeys,
  nonEmptyFlagValue,
  projectIdMismatch,
  localeFromZipEntry,
  resolveDownloadSource,
  type LokaliseKey,
  type OrphanKey,
} from "./translations-lib.ts";

// --- Paths and locale config -------------------------------------------

// build-scripts/translations.ts -> repo root is one dir up.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const TRANSLATIONS_DIR = join(REPO_ROOT, "src", "translations");

// en.json is the in-repo source of truth and the only committed translation
// file: `upload` pushes it to Lokalise as the base, and `download` never
// overwrites it. Every other locale is whatever Lokalise has — no hardcoded
// locale list. Downloaded stems are canonicalized to BCP 47 at the write
// boundary (see localeFromZipEntry) so a Lokalise `zh_CN` lands on disk as
// the repo-conventional `zh-CN.json`.

const translationPath = (locale: string): string =>
  join(TRANSLATIONS_DIR, `${locale}.json`);

// --- Lokalise API client -----------------------------------------------

// Talks to the Lokalise REST API v2 directly
// (https://developers.lokalise.com/reference) using the global `fetch`,
// so the only extra dependency is `fflate` for unzipping downloads.
const API_BASE = "https://api.lokalise.com/api2";

// Both file upload and (async) export are asynchronous: the endpoint
// returns a process id and the work happens in the background. Poll the
// process until it leaves the queued/running state, with a ceiling so a
// stuck process can't hang CI.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300_000;

// Default working file for the orphan review flow: `orphans` writes it,
// `delete-orphans` reads it back. Gitignored — it's a throwaway diff against
// the live Lokalise project, not a committed artifact.
const ORPHANS_FILE = "translation-orphans.json";
// Page size for the keys listing and batch size for bulk delete. Both well
// within Lokalise's per-request ceilings for this project's key count.
const KEYS_PAGE_LIMIT = 500;
const DELETE_CHUNK = 500;

class LokaliseError extends Error {}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface UploadOptions {
  filename: string;
  langIso: string;
  dataB64: string;
  cleanupMode?: boolean;
}

class LokaliseClient {
  private readonly token: string;
  private readonly projectId: string;

  constructor(token: string, projectId: string) {
    if (!token) {
      throw new LokaliseError("Lokalise API token is required (set LOKALISE_API_TOKEN).");
    }
    if (!projectId) {
      throw new LokaliseError(
        "Lokalise project id is required (set LOKALISE_PROJECT_ID)."
      );
    }
    this.token = token;
    this.projectId = projectId;
  }

  // Low-level request returning the raw Response so callers that need the
  // pagination headers (listAllKeys) can read them; `request` wraps this for
  // the common JSON-body case.
  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const resp = await fetch(`${API_BASE}/projects/${this.projectId}/${path}`, {
      method,
      headers: {
        "X-Api-Token": this.token,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new LokaliseError(
        `Lokalise ${method} ${path} failed: HTTP ${resp.status} ${text}`
      );
    }
    return resp;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await this.send(method, path, body);
    return (await resp.json()) as T;
  }

  // List every key in the project, walking offset pagination until the last
  // page (X-Pagination-Page-Count). Translations are excluded from the
  // payload — the orphan diff only needs key ids and names.
  async listAllKeys(): Promise<LokaliseKey[]> {
    const all: LokaliseKey[] = [];
    let page = 1;
    for (;;) {
      const resp = await this.send(
        "GET",
        `keys?limit=${KEYS_PAGE_LIMIT}&page=${page}&include_translations=0`
      );
      const data = (await resp.json()) as { keys?: LokaliseKey[] };
      all.push(...(data.keys ?? []));
      const pageCount = Number(resp.headers.get("x-pagination-page-count") ?? "0");
      if (!Number.isFinite(pageCount) || pageCount <= page) {
        break;
      }
      page += 1;
    }
    return all;
  }

  // Bulk-delete keys by id, chunked to stay within the per-request ceiling.
  async deleteKeys(keyIds: number[]): Promise<void> {
    for (let i = 0; i < keyIds.length; i += DELETE_CHUNK) {
      await this.request("DELETE", "keys", { keys: keyIds.slice(i, i + DELETE_CHUNK) });
    }
  }

  // Upload a base-language file and wait for processing to finish.
  // Returns the finished process payload.
  async uploadFile(opts: UploadOptions): Promise<Record<string, unknown>> {
    const payload = {
      data: opts.dataB64,
      filename: opts.filename,
      lang_iso: opts.langIso,
      // The strings use `{placeholder}` tokens directly; don't let Lokalise
      // rewrite them into its universal placeholder format.
      convert_placeholders: false,
      // Plural strings are authored as ICU MessageFormat; let Lokalise parse
      // them into plural keys so translators get per-form editing.
      detect_icu_plurals: true,
      // Push reworded English copy for existing keys, not just new keys —
      // en.json is the source of truth for the base language. Only the
      // English file is uploaded (lang_iso: en), so this updates English
      // translations only and never clobbers translator edits in other
      // locales, which aren't part of this upload.
      replace_modified: true,
      // When set, keys absent from the uploaded base file are deleted from
      // the project. Off by default; opt in via `upload --cleanup`.
      cleanup_mode: opts.cleanupMode ?? false,
    };
    const result = await this.request<{ process?: { process_id?: string } }>(
      "POST",
      "files/upload",
      payload
    );
    const processId = result.process?.process_id;
    if (!processId) {
      throw new LokaliseError(
        `Upload did not return a process id: ${JSON.stringify(result)}`
      );
    }
    return this.waitForProcess(processId);
  }

  // Poll a queued process (upload or async export) until it finishes and
  // return the finished process payload.
  private async waitForProcess(processId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const result = await this.request<{
        process?: Record<string, unknown>;
      }>("GET", `processes/${processId}`);
      const process = result.process ?? {};
      const status = process.status as string | undefined;
      if (status === "finished") {
        return process;
      }
      if (status === "failed" || status === "cancelled") {
        throw new LokaliseError(
          `Lokalise process ${processId} ${status}: ${JSON.stringify(process)}`
        );
      }
      if (Date.now() > deadline) {
        throw new LokaliseError(
          `Lokalise process ${processId} timed out (last status: ${status}).`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Request an export bundle for every language in the project and
  // return its download URL.
  //
  // The project outgrew Lokalise's synchronous files/download endpoint,
  // which now rejects the export with HTTP 413 ("Project too big for sync
  // export. Please use our async export endpoint instead."). The async
  // endpoint (files/async-download) returns a process id instead of a
  // bundle URL directly; the URL lands in the finished process's
  // details.download_url, reachable through the same poller as upload.
  async downloadBundleUrl(exportSort = "first_added"): Promise<string> {
    const payload = {
      format: "json",
      original_filenames: false,
      bundle_structure: "%LANG_ISO%.json",
      // Omit untranslated keys so the runtime per-key English fallback in
      // localize.ts kicks in — matching the repo rule against English
      // placeholders in non-English files.
      export_empty_as: "skip",
      export_sort: exportSort,
      json_unescaped_slashes: true,
      replace_breaks: false,
      indentation: "2sp",
      // Re-serialize plural keys as a single ICU string ({count, plural, …})
      // and keep `{name}` token style, so the frontend's string-only resolve()
      // renders them through IntlMessageFormat rather than seeing a nested
      // plural object it would drop.
      plural_format: "icu",
      placeholder_format: "icu",
      // No filter_langs: export whatever languages the project has, so
      // adding a locale in Lokalise round-trips with no code change.
    };
    const result = await this.request<{ process_id?: string }>(
      "POST",
      "files/async-download",
      payload
    );
    const processId = result.process_id;
    if (!processId) {
      throw new LokaliseError(
        `Async download did not return a process id: ${JSON.stringify(result)}`
      );
    }
    const process = await this.waitForProcess(processId);
    const details = process.details as { download_url?: string } | undefined;
    const bundleUrl = details?.download_url;
    if (!bundleUrl) {
      throw new LokaliseError(
        `Async download process ${processId} finished without a download_url: ${JSON.stringify(process)}`
      );
    }
    return bundleUrl;
  }
}

// --- GitHub release source ---------------------------------------------

// `download --source release` pulls the locale bundle the release
// workflow attaches to each GitHub release, so a build can reproduce the
// translations a prior release shipped without a Lokalise token.
const GITHUB_API = "https://api.github.com";
const DEFAULT_RELEASE_REPO = "esphome/device-builder-frontend";
const RELEASE_ASSET_NAME = "translations.zip";

interface ReleaseAsset {
  name: string;
  url: string;
}

interface ReleaseResponse {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

// Fetch the named asset from a repo's latest published release and return
// its bytes. Works unauthenticated against public repos; an optional
// GITHUB_TOKEN raises the rate limit and allows private-repo access.
async function fetchLatestReleaseAsset(
  repo: string,
  assetName: string
): Promise<Uint8Array> {
  const token = process.env.GITHUB_TOKEN ?? "";
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const relResp = await fetch(`${GITHUB_API}/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...authHeaders,
    },
  });
  if (!relResp.ok) {
    throw new Error(`Failed to read latest release of ${repo}: HTTP ${relResp.status}`);
  }

  const release = (await relResp.json()) as ReleaseResponse;
  const asset = release.assets?.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `Latest ${repo} release (${release.tag_name ?? "unknown"}) has no '${assetName}' asset.`
    );
  }

  // Hit the asset's API URL with an octet-stream Accept header — GitHub
  // redirects to the signed blob URL (fetch follows it), and this path is
  // identical for public and private repos.
  const assetResp = await fetch(asset.url, {
    headers: { Accept: "application/octet-stream", ...authHeaders },
  });
  if (!assetResp.ok) {
    throw new Error(`Failed to download '${assetName}': HTTP ${assetResp.status}`);
  }
  return new Uint8Array(await assetResp.arrayBuffer());
}

// --- Commands ----------------------------------------------------------

async function runUpload(client: LokaliseClient, cleanup: boolean): Promise<number> {
  const dataB64 = readFileSync(translationPath(BASE_LANGUAGE)).toString("base64");

  const suffix = cleanup ? " (cleanup: removing keys absent from en.json)" : "";
  console.log(
    `Uploading ${BASE_LANGUAGE}.json as base language '${BASE_LANGUAGE}'${suffix}`
  );

  const process = await client.uploadFile({
    filename: `${BASE_LANGUAGE}.json`,
    langIso: BASE_LANGUAGE,
    dataB64,
    cleanupMode: cleanup,
  });

  console.log(`Upload finished (status: ${process.status ?? "unknown"}).`);
  if (process.details) {
    console.log(`  ${JSON.stringify(process.details)}`);
  }
  return 0;
}

// Unpack a zip of `<locale>.json` files into src/translations/, writing
// each locale except the base — en.json is the in-repo source of truth and
// is never overwritten by a download. Stems are canonicalized to BCP 47 so
// a Lokalise `zh_CN.json` lands as `zh-CN.json`. The frontend loader
// discovers whatever files land here, so there is no locale allow-list to
// keep in sync. Returns the sorted locales written. Shared by the Lokalise
// and GitHub-release download paths.
function writeLocaleBundle(files: Record<string, Uint8Array>): string[] {
  const decoder = new TextDecoder();
  const written: string[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const locale = localeFromZipEntry(name);
    if (locale === null || locale === BASE_LANGUAGE) {
      continue;
    }
    writeTranslation(locale, JSON.parse(decoder.decode(bytes)));
    written.push(locale);
  }
  return written.sort();
}

async function runDownload(client: LokaliseClient): Promise<number> {
  console.log("Requesting bundle for all project languages from Lokalise");
  const bundleUrl = await client.downloadBundleUrl();

  const resp = await fetch(bundleUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download bundle: HTTP ${resp.status}`);
  }
  const written = writeLocaleBundle(unzipSync(new Uint8Array(await resp.arrayBuffer())));

  if (written.length === 0) {
    // A Lokalise download that yields no locales is a real failure (wrong
    // project id, empty/corrupt bundle, API hiccup) — fail loudly so a
    // release can't silently ship English-only. The legitimate English-only
    // case is the unset-secrets guard in release.yml, which exits before
    // ever calling download.
    throw new Error("Lokalise returned no non-base translation files.");
  }
  console.log(`Wrote ${written.length} file(s): ${written.join(", ")}`);
  return 0;
}

async function runDownloadFromRelease(): Promise<number> {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_RELEASE_REPO;
  console.log(`Fetching ${RELEASE_ASSET_NAME} from the latest ${repo} release`);
  const zip = await fetchLatestReleaseAsset(repo, RELEASE_ASSET_NAME);
  const written = writeLocaleBundle(unzipSync(zip));

  if (written.length === 0) {
    // Unlike the Lokalise path, an empty release asset isn't a failure: a
    // release built with Lokalise secrets unset legitimately ships
    // English-only, and reproducing it here means writing nothing.
    console.log("Warning: release asset contained no non-base translation files.");
  } else {
    console.log(`Wrote ${written.length} file(s): ${written.join(", ")}`);
  }
  return 0;
}

// --- Orphan review flow ------------------------------------------------

interface OrphanFile {
  _README: string;
  project_id: string;
  generated_at: string;
  count: number;
  orphans: OrphanKey[];
}

const ORPHAN_README =
  "Keys present in Lokalise but absent from src/translations/en.json. " +
  "Remove any entry you want to KEEP — every entry left in `orphans` is " +
  "DELETED from Lokalise by `pnpm run translations:orphans:delete --yes`. " +
  "This is a throwaway working copy and is gitignored.";

// The base-language key set as Lokalise names it: en.json flattened with the
// `::` separator (see flattenKeys). This is what an orphan is diffed against.
function loadBaseKeys(): Set<string> {
  const raw = readFileSync(translationPath(BASE_LANGUAGE), "utf-8");
  return flattenKeys(JSON.parse(raw));
}

async function runOrphans(client: LokaliseClient, outPath: string): Promise<number> {
  const baseKeys = loadBaseKeys();
  console.log("Listing all Lokalise keys");
  const keys = await client.listAllKeys();
  const orphans = findOrphans(keys, baseKeys);

  const file: OrphanFile = {
    _README: ORPHAN_README,
    project_id: process.env.LOKALISE_PROJECT_ID ?? "",
    generated_at: new Date().toISOString(),
    count: orphans.length,
    orphans,
  };
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");

  console.log(
    `${orphans.length} orphan(s) of ${keys.length} Lokalise key(s) ` +
      `(${baseKeys.size} keys in ${BASE_LANGUAGE}.json).`
  );
  console.log(`Wrote ${relative(REPO_ROOT, outPath)}`);
  if (orphans.length > 0) {
    console.log(
      "Review it (delete any entry you want to keep), then run " +
        "`pnpm run translations:orphans:delete --yes`."
    );
  }
  return 0;
}

// Parse the reviewed orphans file back into the key ids to delete. Validates
// shape strictly: a missing `orphans` array or a non-numeric `key_id` is an
// error, not a silent skip, since the next step deletes by these ids.
function readOrphanFile(inPath: string, currentProjectId: string): OrphanKey[] {
  let raw: string;
  try {
    raw = readFileSync(inPath, "utf-8");
  } catch {
    throw new LokaliseError(
      `Orphans file not found: ${inPath}. Run \`pnpm run translations:orphans\` first.`
    );
  }
  let parsed: { project_id?: unknown; orphans?: unknown };
  try {
    parsed = JSON.parse(raw) as { project_id?: unknown; orphans?: unknown };
  } catch (err) {
    throw new LokaliseError(
      `Orphans file ${inPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const mismatch = projectIdMismatch(parsed.project_id, currentProjectId);
  if (mismatch) {
    throw new LokaliseError(
      `Orphans file ${inPath} was generated for Lokalise project ${mismatch}, but ` +
        `LOKALISE_PROJECT_ID is ${currentProjectId}. Refusing to delete keys by id in a ` +
        `different project — regenerate it with \`pnpm run translations:orphans\`.`
    );
  }
  if (!Array.isArray(parsed.orphans)) {
    throw new LokaliseError(`Orphans file ${inPath} has no \`orphans\` array.`);
  }
  return parsed.orphans.map((entry, i) => {
    const o = entry as Partial<OrphanKey>;
    if (typeof o.key_id !== "number") {
      throw new LokaliseError(
        `Orphans file ${inPath}: entry ${i} is missing a numeric \`key_id\`.`
      );
    }
    return {
      key_id: o.key_id,
      key_name: typeof o.key_name === "string" ? o.key_name : String(o.key_id),
    };
  });
}

async function runDeleteOrphans(
  client: LokaliseClient,
  inPath: string,
  confirmed: boolean
): Promise<number> {
  const orphans = readOrphanFile(inPath, process.env.LOKALISE_PROJECT_ID ?? "");
  if (orphans.length === 0) {
    console.log(
      `No orphans listed in ${relative(REPO_ROOT, inPath)}; nothing to delete.`
    );
    return 0;
  }

  if (!confirmed) {
    console.log(
      `Dry run — would delete ${orphans.length} key(s) from Lokalise (pass --yes to apply):`
    );
    for (const o of orphans) {
      console.log(`  ${o.key_id}  ${o.key_name}`);
    }
    return 0;
  }

  console.log(`Deleting ${orphans.length} key(s) from Lokalise`);
  await client.deleteKeys(orphans.map((o) => o.key_id));
  console.log("Done.");
  return 0;
}

function writeTranslation(locale: string, data: unknown): void {
  const path = translationPath(locale);
  // Re-serialize with the repo's JSON conventions (2-space indent, raw
  // unicode, trailing newline) so the output matches Prettier and the PR
  // diff only carries genuine translation changes.
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  console.log(`  ${relative(REPO_ROOT, path)}`);
}

// --- CLI ---------------------------------------------------------------

function usage(): void {
  console.log(
    [
      "Usage:",
      "  pnpm run translations:upload [--cleanup]   Push en.json keys to Lokalise",
      "  pnpm run translations:download                Pull translated locales from Lokalise",
      "  pnpm run translations:download --source release",
      "                                               Pull locales from the latest GitHub release",
      "  pnpm run translations:orphans [--out <file>]",
      "                                               Export keys on Lokalise but not in en.json",
      "  pnpm run translations:orphans:delete [--yes] [--file <file>]",
      "                                               Delete the reviewed orphan keys from Lokalise",
      "",
      "Environment:",
      "  LOKALISE_API_TOKEN   API token with read/write file permissions",
      "  LOKALISE_PROJECT_ID  target project id",
      "  GITHUB_TOKEN         optional; for --source release (rate limit / private repo)",
      "  GITHUB_REPOSITORY    owner/name for --source release (default esphome/device-builder-frontend)",
    ].join("\n")
  );
}

function makeLokaliseClient(): LokaliseClient {
  return new LokaliseClient(
    process.env.LOKALISE_API_TOKEN ?? "",
    process.env.LOKALISE_PROJECT_ID ?? ""
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "--help" || command === "-h" || command === undefined) {
    usage();
    return command === undefined ? 1 : 0;
  }

  try {
    if (command === "download") {
      if (resolveDownloadSource(args) === "release") {
        return await runDownloadFromRelease();
      }
      return await runDownload(makeLokaliseClient());
    }
    if (command === "upload") {
      return await runUpload(makeLokaliseClient(), args.includes("--cleanup"));
    }
    if (command === "orphans") {
      const outPath = nonEmptyFlagValue(args, "--out") ?? join(REPO_ROOT, ORPHANS_FILE);
      return await runOrphans(makeLokaliseClient(), outPath);
    }
    if (command === "delete-orphans") {
      const inPath = nonEmptyFlagValue(args, "--file") ?? join(REPO_ROOT, ORPHANS_FILE);
      return await runDeleteOrphans(makeLokaliseClient(), inPath, args.includes("--yes"));
    }
    console.error(`error: unknown command '${command}'`);
    usage();
    return 1;
  } catch (err) {
    const message =
      err instanceof LokaliseError || err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    return 1;
  }
}

// `main` resolves to an exit code for expected outcomes; the terminal
// `.catch` keeps any unforeseen rejection (e.g. a throw outside main's
// try/catch) on the same non-zero-exit contract instead of surfacing as an
// unhandled rejection that may not fail CI.
main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
