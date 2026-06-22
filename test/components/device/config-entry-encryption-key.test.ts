/**
 * Pins the api.encryption.key field's inline generate affordance: it renders
 * for the encryption key, emits a valid key on click, and stays absent for an
 * ordinary password field or when the value references a secret.
 */
import { describe, expect, it, type Mock } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { isValidApiEncryptionKey } from "../../../src/util/api-encryption-key.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

const KEY_PATH = ["encryption", "key"];

const keyEntry = () =>
  makeEntry(ConfigEntryType.SECURE_STRING, { key: "key", label: "Encryption key" });

function renderKeyField(value: string) {
  const ctx = makeRenderCtx(
    { encryption: { key: value } },
    { overrides: { sectionKey: "api" } }
  );
  return { ctx, tpl: renderStringField(keyEntry(), "password", KEY_PATH, ctx) };
}

describe("api encryption key field", () => {
  it("renders a generate affordance that emits a valid key", () => {
    const { ctx, tpl } = renderKeyField("");
    const buttons = findElementBindings(tpl, "button");
    expect(buttons).toHaveLength(1);
    (buttons[0]["@click"] as () => void)();
    expect(ctx.emitChange).toHaveBeenCalledTimes(1);
    const [path, value] = (ctx.emitChange as Mock).mock.calls[0];
    expect(path).toEqual(KEY_PATH);
    expect(isValidApiEncryptionKey(value as string)).toBe(true);
  });

  it("omits the affordance for an ordinary password field", () => {
    const ctx = makeRenderCtx(
      { password: "" },
      { overrides: { sectionKey: "ota.esphome" } }
    );
    const tpl = renderStringField(
      makeEntry(ConfigEntryType.SECURE_STRING, { key: "password" }),
      "password",
      ["password"],
      ctx
    );
    expect(findElementBindings(tpl, "button")).toHaveLength(0);
  });

  it("omits the affordance when the key references a secret", () => {
    const { tpl } = renderKeyField("!secret api_encryption_key");
    expect(findElementBindings(tpl, "button")).toHaveLength(0);
  });

  it("omits the affordance once a valid key is present, so a click can't clobber it", () => {
    const { tpl } = renderKeyField("a".repeat(43) + "=");
    expect(findElementBindings(tpl, "button")).toHaveLength(0);
  });

  it("omits the affordance over a ${substitution}, so a click can't clobber the reference", () => {
    const { tpl } = renderKeyField("${api_key}");
    expect(findElementBindings(tpl, "button")).toHaveLength(0);
  });
});
