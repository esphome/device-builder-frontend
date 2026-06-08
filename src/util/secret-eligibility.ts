import { unescapeYamlDoubleQuoted } from "./yaml-escape.js";
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";

/**
 * Fields whose secret is shared across every device — the WiFi credentials —
 * use a fixed, non-scoped key. This doubles as the picker-eligibility
 * allowlist for non-concealed fields (WiFi SSID is plain text, so it isn't
 * caught by the renderer's password-input check). Keyed by ``sectionKey``
 * then ``entry.key``.
 */
const SHARED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  wifi: { ssid: "wifi_ssid", password: "wifi_password" },
};

/** Field-bound shared secret names (``wifi_ssid``, ``wifi_password``) — each
 *  belongs to one specific field and shouldn't be offered on the others. */
const FIELD_BOUND_SHARED = new Set(
  Object.values(SHARED).flatMap((m) => Object.values(m))
);

/** Per-device base names for the well-known credential fields, joined to the
 *  hostname as ``<hostname>__<base>``. Keyed by ``sectionKey`` then key. */
const DEVICE_BASE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Keyed by the editor sectionKey (the OTA esphome platform is `ota.esphome`),
  // so the field picker and the security notice agree on the secret name.
  "ota.esphome": { password: "ota_password" },
  api: { key: "encryption_key" },
  web_server: { password: "web_password" },
};

/** True when a non-concealed *key* under *sectionKey* still wants the picker. */
export function isSecretEligible(sectionKey: string, key: string): boolean {
  return SHARED[sectionKey]?.[key] !== undefined;
}

/**
 * Whether *key* is shared across devices rather than scoped to *hostname*.
 * Only this device's ``<host>__…`` namespace counts as device-specific;
 * everything else (``wifi_*``, plain names, another device's key, or an
 * ambiguous single-underscore form) is treated as shared, so overwriting its
 * value warns. An unknown hostname can't prove scoping → shared.
 */
export function isSharedSecret(key: string, hostname: string): boolean {
  const host = slug(hostname);
  return !host || !key.startsWith(`${host}__`);
}

/** Lowercase + collapse anything outside ``[a-z0-9_]`` so a hostname or
 *  field name is safe to embed in a secret key. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Drop per-device secrets (``<host>__<base>``) scoped to a device *other* than
 * *currentHostname*. Shared keys (``wifi_ssid``) and unscoped names are kept;
 * only keys whose ``__`` prefix matches another known device's hostname are
 * removed — so the picker doesn't offer one device's encryption key on another.
 */
export function withoutForeignDeviceSecrets(
  keys: readonly string[],
  currentHostname: string,
  allDeviceNames: readonly string[]
): string[] {
  const current = slug(currentHostname);
  // Without the current host we can't tell ours from theirs — don't filter, or
  // we'd hide the current device's own keys (and the migrate target) during the
  // brief window before the device name resolves.
  if (!current) return [...keys];
  const others = new Set(
    allDeviceNames.map((n) => slug(n)).filter((h) => h && h !== current)
  );
  if (others.size === 0) return [...keys];
  return keys.filter((k) => {
    const i = k.indexOf("__");
    return i <= 0 || !others.has(k.slice(0, i));
  });
}

/**
 * The secrets to show in a field's picker. Drops other devices' per-device
 * secrets (via :func:`withoutForeignDeviceSecrets`) and field-bound shared
 * secrets (``wifi_ssid`` / ``wifi_password``) that aren't relevant to *this*
 * field — so a WiFi SSID field still offers ``wifi_ssid`` but an OTA password
 * or encryption-key field doesn't.
 *
 * *keep* is the set that's never field-filtered: the field's recommendations
 * plus its currently-selected key (so the active value is always listed).
 */
export function visibleSecretKeys(
  keys: readonly string[],
  keep: readonly string[],
  currentHostname: string,
  allDeviceNames: readonly string[]
): string[] {
  const kept = new Set(keep.filter(Boolean));
  // `kept` is exempt from BOTH filters (foreign-device and field-bound), so the
  // currently-selected value is always listed even in the (unreachable-via-UI)
  // case where it's another device's per-device secret. Filter the original
  // list so order is preserved.
  const afterForeign = new Set(
    withoutForeignDeviceSecrets(keys, currentHostname, allDeviceNames)
  );
  return keys.filter(
    (k) => kept.has(k) || (afterForeign.has(k) && !FIELD_BOUND_SHARED.has(k))
  );
}

/** Per-device key forms, most-preferred first. A double underscore joins the
 *  hostname and base so a device name that itself contains an underscore
 *  (``my_device``) stays unambiguous; the single-underscore form is kept too
 *  so secrets created before this convention still surface as recommended. */
function scoped(host: string, base: string): string[] {
  return [`${host}__${base}`, `${host}_${base}`];
}

/**
 * Recommended ``secrets.yaml`` key names for a field, most-preferred first.
 * Used to surface a "Recommended" group at the top of the picker and as the
 * target when migrating an inline value into a secret. ``[]`` when nothing
 * sensible can be recommended (no hostname for a per-device field).
 *
 * - WiFi SSID / password → the shared ``wifi_ssid`` / ``wifi_password``.
 * - Known per-device fields → ``<hostname>__ota_password`` /
 *   ``<hostname>__encryption_key`` (plus the single-underscore back-compat
 *   form).
 * - Any other concealed field → ``<hostname>__<section>_<key>``.
 *
 * *hostname* is the backend-resolved ESPHome node name (substitutions already
 * expanded), threaded through the render context.
 */
export function recommendedSecretKeys(
  sectionKey: string,
  key: string,
  hostname: string,
  concealed: boolean
): string[] {
  const shared = SHARED[sectionKey]?.[key];
  if (shared) return [shared];

  const host = slug(hostname);
  if (!host) return [];

  const base = DEVICE_BASE[sectionKey]?.[key];
  if (base) return scoped(host, base);

  // Generic per-device fallback for any other concealed credential field.
  if (concealed) {
    const tail = slug(`${sectionKey}_${key}`);
    return tail ? scoped(host, tail) : [];
  }
  return [];
}

/** The literal value of a top-level ``key`` in a flat ``secrets.yaml``, or
 *  ``null`` when the key isn't found. Used to inline a secret's value back
 *  into a field when the user reverts to a manually typed value. */
export function secretValueFromYaml(yaml: string, key: string): string | null {
  for (const line of yaml.split("\n")) {
    // Top-level `key: value` only — skip indentation, blanks, and comments.
    if (!line || line[0] === " " || line[0] === "\t" || line[0] === "#") continue;
    // The mapping separator is the first `:` followed by whitespace or EOL,
    // so a key (or value) that itself contains a colon doesn't mis-match.
    const colon = line.search(/:(\s|$)/);
    if (colon < 0 || line.slice(0, colon).trim() !== key) continue;
    const rhs = splitInlineComment(line.slice(colon + 1)).value.trim();
    // A double-quoted scalar (what `formatYamlScalar` emits when escaping) must
    // be unescaped to invert the write — `parseScalar`/`stripQuotes` only slice
    // the quotes, so a value containing `"` or `\` would otherwise round-trip
    // corrupted (migrate → manual-revert).
    if (rhs.length >= 2 && rhs.startsWith('"') && rhs.endsWith('"')) {
      return unescapeYamlDoubleQuoted(rhs.slice(1, -1));
    }
    // Plain or single-quoted: strip quotes WITHOUT YAML type coercion — a
    // secret is an opaque string, so a hand-written `ota_pw: yes` must stay
    // "yes", not be coerced to "true" by parseScalar.
    return stripQuotes(rhs);
  }
  return null;
}
