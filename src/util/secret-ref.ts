/** A `!secret <key>` value points the field at an entry in the secrets store
 *  rather than holding a literal. */
const SECRET_REF_RE = /^!secret\s+(\S+)\s*$/;

/** The key a `!secret <key>` value points at, or `null` if not a ref. */
export function secretRefKey(value: string): string | null {
  return value.match(SECRET_REF_RE)?.[1] ?? null;
}

/** Whether *value* is a `!secret <key>` reference. */
export function isSecretRef(value: string): boolean {
  return SECRET_REF_RE.test(value);
}
