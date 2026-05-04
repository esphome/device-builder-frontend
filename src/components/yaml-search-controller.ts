/**
 * Shared YAML-content-search reactive controller.
 *
 * Used by every UI surface that drives a live, debounced
 * ``yaml/search`` against the backend — currently the command
 * palette and the dashboard's YAML-mode search. Bundles every
 * piece of state a host needs:
 *
 * - ``hits`` — the current result list (``null`` while a search
 *   is pending or in flight; ``[]`` after a fetch returned no
 *   matches; non-empty array of hits otherwise).
 * - debounce timer so rapid keystrokes only fire one round
 *   trip per pause.
 * - sequence number so a slow in-flight call's response can't
 *   overwrite results from a newer query that fired during its
 *   wait.
 * - ``TrailingEdgeDispatcher`` so at most one search runs at a
 *   time and only the latest input survives across an in-flight
 *   window (so a typing storm collapses to "first + last"
 *   rather than "every keystroke").
 *
 * Hosted on the consumer via ``addController`` so a host
 * disconnect (palette removed from DOM, dashboard navigated
 * away from) calls ``clear()`` automatically — no leaked timers
 * or pending dispatches across a teardown.
 *
 * Hosts only ever talk to ``hits``, ``scheduleQuery``, ``sync``,
 * and ``clear``; everything else is internal.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/index.js";
import type { YamlSearchHit } from "../api/types.js";
import { TrailingEdgeDispatcher } from "../util/trailing-edge-dispatcher.js";

/** Time between the last keystroke and the WS request firing. */
const DEBOUNCE_MS = 150;

export class YamlSearchController implements ReactiveController {
  /** Current search results — see class docstring for the tri-state. */
  hits: YamlSearchHit[] | null = null;

  private readonly _host: ReactiveControllerHost;
  private readonly _getApi: () => ESPHomeAPI;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _seq = 0;
  private readonly _dispatcher: TrailingEdgeDispatcher<string>;

  constructor(host: ReactiveControllerHost, getApi: () => ESPHomeAPI) {
    this._host = host;
    this._getApi = getApi;
    host.addController(this);
    this._dispatcher = new TrailingEdgeDispatcher<string>((q) => this._run(q));
  }

  hostConnected(): void {
    /* no-op — every state slot is initialised in the constructor */
  }

  hostDisconnected(): void {
    this.clear();
  }

  /**
   * Schedule a debounced search for *query*.
   *
   * Cancels any pending debounce timer, invalidates in-flight
   * results immediately by clearing ``hits`` to ``null`` and
   * bumping the sequence number, then arms a fresh timer. When
   * the timer fires, the dispatcher takes over: at most one
   * search in flight, latest pending input replays on resolve.
   *
   * The immediate ``hits = null`` matters because an in-flight
   * call against an older query that resolves during the
   * debounce window would otherwise overwrite the empty-while-
   * pending state with stale results — visible to the user as
   * a brief flicker of the wrong query's hits.
   */
  scheduleQuery(query: string): void {
    this._clearTimer();
    this.hits = null;
    this._seq++;
    this._host.requestUpdate();
    this._timer = setTimeout(() => {
      this._timer = null;
      this._dispatcher.dispatch(query);
    }, DEBOUNCE_MS);
  }

  /**
   * Bridge a host-owned ``(active, body)`` pair to the controller.
   *
   * Convenience for hosts that own the mode flag externally
   * (the command palette's ``/`` prefix gate, the dashboard's
   * search-icon toggle) and want a single call site for "user
   * typed / toggled mode": when inactive or body is
   * empty/whitespace, drops state via ``clear``; otherwise
   * debounces via ``scheduleQuery``. Hosts can still call
   * ``clear`` / ``scheduleQuery`` directly when they want to
   * bypass the empty-body short-circuit.
   */
  sync(active: boolean, body: string): void {
    const trimmed = body.trim();
    if (!active || !trimmed) {
      this.clear();
      return;
    }
    this.scheduleQuery(trimmed);
  }

  /**
   * Drop all state — pending timer, queued input, current hits.
   *
   * Called when the palette closes, when the user drops out of
   * YAML-search mode, or when the query body becomes empty.
   * Doesn't cancel an already-running fetch (we can't abort the
   * WS), but bumps the seq so the in-flight call's result is
   * discarded on resolve.
   */
  clear(): void {
    this._clearTimer();
    this._dispatcher.cancelPending();
    this.hits = null;
    this._seq++;
    this._host.requestUpdate();
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _run(query: string): Promise<void> {
    const seq = ++this._seq;
    try {
      const hits = await this._getApi().searchYaml({ query });
      // Drop stale responses — the seq advanced past us while
      // we were awaiting (newer query scheduled, palette cleared,
      // host disconnected, etc.).
      if (seq !== this._seq) return;
      this.hits = hits;
    } catch {
      // Swallow: WS hiccups / rejected requests fall back to
      // "no hits" rendering rather than error-toasting the
      // dropdown.
      if (seq === this._seq) this.hits = [];
    }
    this._host.requestUpdate();
  }
}
