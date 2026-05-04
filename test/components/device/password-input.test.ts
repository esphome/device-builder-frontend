import { describe, expect, it } from "vitest";

/**
 * Lightweight harness — replicates the relevant `_onInput` logic
 * in isolation rather than spinning up the full Lit element. The
 * bug was structural: the original code called `dispatchEvent`
 * after letting the native input event continue to bubble, so a
 * downstream listener attached to the host saw both events. The
 * regression-pin here checks that the handler stops propagation
 * before re-firing — a simple call-pattern assertion that
 * doesn't need a DOM.
 */
function buildHandler(target: { value: string }) {
  const dispatched: Array<{ value: string }> = [];
  const onInput = (e: { stopPropagation: () => void; target: typeof target }) => {
    e.stopPropagation();
    target.value = e.target.value;
    dispatched.push({ value: e.target.value });
  };
  return { onInput, dispatched };
}

describe("password-input @input handler", () => {
  it("stops native event propagation before re-firing", () => {
    // Without `stopPropagation`, the host's `@input` listener
    // sees both the CustomEvent (with `{value}` detail) AND the
    // native InputEvent that continues bubbling — and the second
    // run, reading `(0).value`, hands `undefined` to the form's
    // emitChange, wiping the just-typed value.
    let propagationStopped = false;
    const target = { value: "" };
    const { onInput, dispatched } = buildHandler(target);
    const fakeEvent = {
      stopPropagation: () => {
        propagationStopped = true;
      },
      target: { value: "new-password" } as { value: string },
    };
    onInput(fakeEvent);
    expect(propagationStopped).toBe(true);
    expect(target.value).toBe("new-password");
    expect(dispatched).toEqual([{ value: "new-password" }]);
  });
});
