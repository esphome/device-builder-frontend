/**
 * @vitest-environment happy-dom
 *
 * Pins the shared reveal widget: masked by default, eye toggles, copy goes
 * through the clipboard helper, a lazy `resolve` is fetched once, and `resetKey`
 * re-masks so switching targets doesn't leak the previous value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
const { copySpy } = vi.hoisted(() => ({ copySpy: vi.fn().mockResolvedValue(true) }));
vi.mock("../../src/util/copy-to-clipboard.js", () => ({ copyToClipboard: copySpy }));

import toast from "sonner-js";
import { ESPHomeSecretReveal } from "../../src/components/secret-reveal.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const MASK = "••••••••••";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(props: Partial<ESPHomeSecretReveal>) {
  const el = new ESPHomeSecretReveal();
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const valueText = (el: ESPHomeSecretReveal) =>
  el.shadowRoot!.querySelector(".value")!.textContent!.trim();
const buttons = (el: ESPHomeSecretReveal) =>
  Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".btn"));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-secret-reveal", () => {
  it("gives the icon-only buttons accessible names (aria-label)", async () => {
    const el = await mount({ value: "x" });
    expect(
      buttons(el).every((b) => (b.getAttribute("aria-label") || "").length > 0)
    ).toBe(true);
  });

  it("masks by default and reveals/hides on the eye toggle", async () => {
    const el = await mount({ value: "swordfish" });
    expect(valueText(el)).toBe(MASK);

    buttons(el)[0].click();
    await el.updateComplete;
    expect(valueText(el)).toBe("swordfish");

    buttons(el)[0].click();
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK);
  });

  it("resolves a lazy value once, on first reveal", async () => {
    const resolve = vi.fn().mockResolvedValue("hunter2");
    const el = await mount({ resolve });

    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(valueText(el)).toBe("hunter2");

    // hide + show again → cached, not re-fetched
    buttons(el)[0].click();
    await el.updateComplete;
    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejecting resolver and stays masked (no unhandled rejection)", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("ws blip"));
    const el = await mount({ resolve });
    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK);
  });

  it("ignores a stale in-flight resolve when the target changes", async () => {
    let release!: (v: string) => void;
    const resolve = vi.fn(() => new Promise<string>((r) => (release = r)));
    const el = await mount({ resolve });
    buttons(el)[0].click(); // starts the resolve (in flight)
    (el as any).resetKey = "switched"; // target changes before it resolves
    await el.updateComplete;
    release("leaked-value"); // late result for the old target
    await tick();
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK); // not revealed
    expect((el as any)._resolved).toBeUndefined(); // stale value dropped
  });

  it("retries after a failed (null) resolve instead of caching empty", async () => {
    const resolve = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("later");
    const el = await mount({ resolve });
    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK); // first resolve failed → still masked

    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(resolve).toHaveBeenCalledTimes(2); // re-fetched, not cached empty
    expect(valueText(el)).toBe("later");
  });

  it("copies the value via the clipboard helper", async () => {
    const el = await mount({ value: "abc123" });
    buttons(el)[1].click();
    await tick();
    expect(copySpy).toHaveBeenCalledWith("abc123");
    expect(toast.success).toHaveBeenCalled();
  });

  it("copies a legitimately empty secret value", async () => {
    const el = await mount({ value: "" });
    buttons(el)[1].click();
    await tick();
    expect(copySpy).toHaveBeenCalledWith("");
    expect(toast.success).toHaveBeenCalled();
  });

  it("does nothing on reveal/copy when no value source is set", async () => {
    const el = await mount({}); // no value, no resolve
    buttons(el)[0].click();
    await tick();
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK); // can't reveal nothing
    buttons(el)[1].click();
    await tick();
    expect(copySpy).not.toHaveBeenCalled();
  });

  it("re-masks when resetKey changes (no value leak across targets)", async () => {
    const el = await mount({ value: "first" });
    buttons(el)[0].click();
    await el.updateComplete;
    expect(valueText(el)).toBe("first");

    (el as any).resetKey = "other";
    await el.updateComplete;
    expect(valueText(el)).toBe(MASK);
  });
});
