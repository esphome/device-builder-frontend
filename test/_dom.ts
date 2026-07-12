/**
 * Shared DOM and settle helpers for the test suites.
 *
 * Nearly every component/dialog test used to hand-roll the same snippets:
 * an async mount (append + settle), a render-into-a-container helper for
 * pure template functions, an identity localize stub for host fakes, and
 * a flush helper in one of three shapes (zero-delay timeout, microtask
 * drain, fake-timer advance). They live here once instead;
 * ``test/_setup-dom.ts`` owns the matching ``document.body`` cleanup
 * between tests.
 */
import { render } from "lit";
import { vi } from "vitest";

/**
 * Append ``el`` to ``document.body`` and wait for its first render.
 *
 * ``props`` is ``Object.assign``ed onto the element before it is attached,
 * for suites that seed public props or private state ahead of the initial
 * update. Constrained to ``HTMLElement`` (not ``LitElement``) so plain
 * elements mount too; ``updateComplete`` is awaited when the element has
 * one (every Lit element) and is a no-op await otherwise.
 */
export async function mount<T extends HTMLElement>(
  el: T,
  props?: Partial<T>
): Promise<T> {
  if (props) {
    Object.assign(el, props);
  }
  document.body.appendChild(el);
  await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  return el;
}

/**
 * Render a template into a fresh ``<div>`` attached to ``document.body``
 * and return the container.
 *
 * Takes ``unknown`` (mirroring lit's own ``render`` signature) so pure
 * renderers that return ``TemplateResult | typeof nothing`` pass without
 * a cast. The container is left attached; the global body cleanup in
 * ``test/_setup-dom.ts`` removes it between tests.
 */
export function renderInto(tpl: unknown): HTMLElement {
  const container = document.createElement("div");
  render(tpl, container);
  document.body.appendChild(container);
  return container;
}

/** Identity localize stub for host fakes: returns the key unchanged. */
export const identityLocalize = (key: string): string => key;

/**
 * Click ``target`` and return which of ``names`` fired on ``listenOn``,
 * in order — the "emits A, not B" assertion is then a single
 * ``toEqual(["A"])``.
 */
export function clickCollect(
  listenOn: HTMLElement,
  target: HTMLElement,
  names: string[]
): string[] {
  const fired: string[] = [];
  const handlers = names.map((name) => {
    const handler = () => fired.push(name);
    listenOn.addEventListener(name, handler);
    return [name, handler] as const;
  });
  target.click();
  for (const [name, handler] of handlers) {
    listenOn.removeEventListener(name, handler);
  }
  return fired;
}

/**
 * Await the host's update *and* its nested ``<esphome-base-dialog>``'s.
 *
 * The base dialog binds its ``confirmOnEnter`` Enter listener in its own
 * ``willUpdate`` — one update cycle after the host renders ``?open`` — so
 * a test that presses Enter right after the host's ``updateComplete``
 * races the binding. Settle both cycles before (and after close, to see
 * the detach) dispatching keydowns.
 */
export async function baseDialogSettled(el: HTMLElement): Promise<void> {
  await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  const base = el.shadowRoot?.querySelector("esphome-base-dialog");
  await (base as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
}

/** Resolve after a zero-delay timeout so queued real-timer callbacks run. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Drain ``times`` microtask turns — one per await/``.then`` link the chain under test needs. */
export async function flushMicrotasks(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/** ``flush`` for suites under ``vi.useFakeTimers``: run zero-delay fake timers. */
export async function flushTimers(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}
