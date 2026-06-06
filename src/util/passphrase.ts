/**
 * A memorable, unpredictable passphrase: `words` random words from a curated
 * wordlist joined with `-` (e.g. `jumping-brown-fox-under`). Used for generated
 * OTA / web_server credentials — strong (~11 bits/word) but readable if the user
 * ever needs to type it.
 *
 * The ~2k-word list is **dynamically imported** so it lands in its own async
 * chunk instead of the entry bundle — it's only fetched the first time a
 * passphrase is generated (behind the security-notice confirm dialog), then
 * cached by the module loader. Words are drawn with `crypto.getRandomValues`
 * using rejection sampling, so the selection is uniform (no modulo bias) and not
 * predictable.
 */
export async function generatePassphrase(words = 4): Promise<string> {
  // Guard against a non-positive count yielding an empty (insecure) credential.
  const count = Math.max(1, Math.trunc(words));
  const { PASSPHRASE_WORDS } = await import("./passphrase-words.js");
  const n = PASSPHRASE_WORDS.length;
  // Largest multiple of `n` that fits in a uint32; values at or above it are
  // rejected so each word is equally likely.
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  const picked: string[] = [];
  while (picked.length < count) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    picked.push(PASSPHRASE_WORDS[buf[0] % n]);
  }
  return picked.join("-");
}
