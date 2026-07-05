/**
 * @vitest-environment happy-dom
 *
 * Pins the infinite-scroll wiring of <esphome-wizard-step-board-list>: the
 * sentinel renders only while more pages remain, is observed against the
 * viewport, and a crossing dispatches load-more; add-board carries the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

class MockObserver {
  static instances: MockObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public cb: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    MockObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  trigger(isIntersecting: boolean) {
    this.cb(
      [{ isIntersecting, target: this.observed[0] } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import { ESPHomeWizardStepBoardList } from "../../src/components/wizard/wizard-step-board-list.js";
import { identityLocalize } from "../_dom.js";

const board = (i: number): BoardCatalogEntry =>
  ({
    id: `b${i}`,
    name: `Test Board ${i}`,
    description: "A generic ESP32 board.",
    featured: false,
    tags: [],
    docs_url: "https://esphome.io/",
    images: [],
    esphome: { platform: "esp32", variant: "", mcu: "" },
  }) as unknown as BoardCatalogEntry;

async function mount(
  boards: BoardCatalogEntry[],
  hasMore: boolean
): Promise<ESPHomeWizardStepBoardList> {
  const el = new ESPHomeWizardStepBoardList();
  el.boards = boards;
  el.hasMore = hasMore;
  el.localize = identityLocalize;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sentinelOf = (el: ESPHomeWizardStepBoardList) =>
  el.shadowRoot!.querySelector(".sentinel");

const lastObserver = () => MockObserver.instances[MockObserver.instances.length - 1];

beforeEach(() => {
  MockObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("esphome-wizard-step-board-list infinite scroll", () => {
  it("renders a sentinel and observes it against the viewport when more pages remain", async () => {
    const el = await mount([board(0), board(1)], true);
    const sentinel = sentinelOf(el);
    expect(sentinel).not.toBeNull();
    const obs = lastObserver();
    expect(obs.observed[0]).toBe(sentinel);
    expect(obs.options).toMatchObject({ root: null }); // viewport, so mobile keeps loading
  });

  it("omits the sentinel and never observes when the list is full", async () => {
    const el = await mount([board(0)], false);
    expect(sentinelOf(el)).toBeNull();
    expect(MockObserver.instances).toHaveLength(0);
  });

  it("dispatches load-more when the sentinel scrolls into view", async () => {
    const el = await mount([board(0), board(1)], true);
    const onLoadMore = vi.fn();
    el.addEventListener("load-more", onLoadMore);

    lastObserver().trigger(false);
    expect(onLoadMore).not.toHaveBeenCalled();
    lastObserver().trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows an error message instead of the empty state when a fetch failed", async () => {
    const el = await mount([], false);
    el.error = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".loading")!.textContent!.trim()).toBe(
      "wizard.boards_load_error"
    );
  });

  it("shows a retry affordance (not the sentinel) when a load-more page fails", async () => {
    const el = await mount([board(0), board(1)], true);
    el.error = true;
    await el.updateComplete;

    // Sentinel is replaced by the retry control so the observer can't re-spin.
    expect(sentinelOf(el)).toBeNull();
    const retry = el.shadowRoot!.querySelector<HTMLButtonElement>(".retry-link");
    expect(retry).not.toBeNull();

    const onLoadMore = vi.fn();
    el.addEventListener("load-more", onLoadMore);
    retry!.click();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("dispatches add-board with the chosen board", async () => {
    const b = board(0);
    const el = await mount([b], false);
    const onAdd = vi.fn();
    el.addEventListener("add-board", onAdd as EventListener);

    el.shadowRoot!.querySelector<HTMLElement>(".select-board")!.click();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail.board).toBe(b);
  });
});
