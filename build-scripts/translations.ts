// Sync frontend translations with Lokalise.
//
//   npm run translations:upload [-- --cleanup]   push en.json to Lokalise
//   npm run translations:download                pull translated locales from Lokalise
//   npm run translations:download -- --source release
//                                                pull locales from the latest GitHub release
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
  localeFromZipEntry,
  resolveDownloadSource,
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    return (await resp.json()) as T;
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
      // Keys use manual _singular/_plural suffixes, not ICU plurals.
      detect_icu_plurals: false,
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
      "  npm run translations:upload [-- --cleanup]   Push en.json keys to Lokalise",
      "  npm run translations:download                Pull translated locales from Lokalise",
      "  npm run translations:download -- --source release",
      "                                               Pull locales from the latest GitHub release",
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
