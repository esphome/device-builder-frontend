/**
 * @vitest-environment happy-dom
 *
 * Pins the shared OverflowMenuElement scaffolding: toggle/close open state,
 * Escape-to-close, Enter/Space activation of menu rows, and bubbling emit.
 */
import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverflowMenuElement } from "../../src/components/overflow-menu-element.js";

@customElement("test-overflow-menu")
class TestOverflowMenu extends OverflowMenuElement {
  render() {
    return html`
      <button class="trigger" @click=${this._toggle}></button>
      ${
        this._open
          ? html`
              <div class="backdrop" @click=${this._close}></div>
              <div
                class="item"
                role="menuitem"
                tabindex="0"
                @click=${() => this._emit("chosen", { v: 1 })}
                @keydown=${this._onItemKeydown}
              ></div>
            `
          : nothing
      }
    `;
  }
}

async function mount(): Promise<TestOverflowMenu> {
  const el = new TestOverflowMenu();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function trigger(el: TestOverflowMenu): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".trigger")!;
}

function item(el: TestOverflowMenu): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(".item");
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("OverflowMenuElement", () => {
  it("toggles open then closed from the trigger", async () => {
    const el = await mount();
    expect(item(el)).toBeNull();
    trigger(el).click();
    await el.updateComplete;
    expect(item(el)).not.toBeNull();
    trigger(el).click();
    await el.updateComplete;
    expect(item(el)).toBeNull();
  });

  it("closes on the backdrop click", async () => {
    const el = await mount();
    trigger(el).click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".backdrop")!.click();
    await el.updateComplete;
    expect(item(el)).toBeNull();
  });

  it("closes on Escape while open, and only while open", async () => {
    const el = await mount();
    // Escape while closed is a no-op (no listener bound).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await el.updateComplete;
    expect(item(el)).toBeNull();

    trigger(el).click();
    await el.updateComplete;
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
    );
    await el.updateComplete;
    expect(item(el)).toBeNull();
  });

  it("activates a row on Enter and Space, but ignores other keys", async () => {
    const el = await mount();
    trigger(el).click();
    await el.updateComplete;
    const onChosen = vi.fn();
    el.addEventListener("chosen", onChosen);
    const row = item(el)!;
    const press = (key: string) =>
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );

    press("Enter");
    press(" ");
    expect(onChosen).toHaveBeenCalledTimes(2);

    press("a");
    expect(onChosen).toHaveBeenCalledTimes(2);
  });

  it("emits a bubbling, composed event carrying detail", async () => {
    const el = await mount();
    trigger(el).click();
    await el.updateComplete;
    let received: CustomEvent | null = null;
    el.addEventListener("chosen", (e) => (received = e as CustomEvent));
    item(el)!.click();
    expect(received).not.toBeNull();
    expect(received!.bubbles).toBe(true);
    expect(received!.composed).toBe(true);
    expect(received!.detail).toEqual({ v: 1 });
  });
});
