import { describe, expect, it } from "vitest";

import { isSecretsRefusal } from "../../../src/components/wizard/wizard-error-bar.js";

describe("isSecretsRefusal", () => {
  it.each([
    'Can\'t create: secrets.yaml has a duplicate key "api_key" (lines 4 and 5). Fix it on the Secrets page and try again.',
    "Can't rename: secrets.yaml doesn't parse: mapping values are not allowed here in secrets.yaml, line 3, column 5. Fix it on the Secrets page and try again.",
    "Can't save Wi-Fi credentials: secrets.yaml defines \"wifi_password\" where the dashboard can't rewrite it. Fix it on the Secrets page and try again.",
  ])("matches the backend refusal: %s", (message) => {
    expect(isSecretsRefusal(message)).toBe(true);
  });

  it.each([
    "Configuration secrets.yaml exists",
    "Can't create — config doesn't validate: [esphome] required key not provided",
    "",
  ])("ignores other errors: %s", (message) => {
    expect(isSecretsRefusal(message)).toBe(false);
  });
});
