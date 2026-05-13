/**
 * ESPHome Device Builder API client.
 *
 * Single multiplexed WebSocket connection to /ws.
 * All commands use the {command, message_id, args} → {result} protocol.
 * Streaming commands (compile, upload, logs, validate, clean) receive
 * EventMessages with "output" and "result" events.
 */
import { APIError } from "./api-error.js";
import { BASE_PATH } from "../util/base-path.js";
import { clearStoredToken, getStoredToken, setStoredToken } from "../util/auth-token.js";
import type {
  AddComponentResponse,
  ArchivedDevice,
  BoardCatalogEntry,
  BulkActionResult,
  CommandMessage,
  ComponentCatalogEntry,
  ConfiguredDevice,
  DevicesResponse,
  EditorValidateResponse,
  ErrorMessage,
  EventMessage,
  EventSubscriptionCallback,
  FirmwareBinary,
  Label,
  ReachabilityStateEvent,
  ReachabilitySubscription,
  FirmwareDownload,
  FirmwareJob,
  IdentityView,
  PagedBoardsResponse,
  PagedComponentsResponse,
  OffloaderRemoteBuildSettings,
  PairingSummary,
  PairingWindowState,
  PeerSummary,
  RemoteBuildPeer,
  RemoteBuildSettings,
  RemoteBuildSubmitTarget,
  ResultMessage,
  DetectChipResult,
  SerialPort,
  ServerInfoMessage,
  OnboardingState,
  StreamCallbacks,
  UpdateDeviceResponse,
  UserPreferences,
  WizardResponse,
  YamlSearchHit,
} from "./types.js";

interface AuthLoginResult {
  token: string;
  expires_at: number;
}

/** Mask sensitive auth fields when logging — tokens / passwords show
 *  up in support tickets via attached browser console logs. The
 *  formatted command/result still has shape, just no secret values. */
function redactForLog(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object") return payload;
  const obj = payload as Record<string, unknown>;
  const command = typeof obj.command === "string" ? obj.command : null;
  const isAuth =
    (command !== null && command.startsWith("auth")) ||
    "token" in obj ||
    "password" in obj;
  if (!isAuth) return payload;
  const clone: Record<string, unknown> = { ...obj };
  if (clone.args && typeof clone.args === "object") {
    const args = clone.args as Record<string, unknown>;
    const safeArgs: Record<string, unknown> = { ...args };
    if ("token" in safeArgs) safeArgs.token = "<redacted>";
    if ("password" in safeArgs) safeArgs.password = "<redacted>";
    clone.args = safeArgs;
  }
  if (clone.result && typeof clone.result === "object") {
    const result = clone.result as Record<string, unknown>;
    if ("token" in result) {
      clone.result = { ...result, token: "<redacted>" };
    }
  }
  return clone;
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type StreamHandler = {
  onOutput?: (line: string) => void;
  onResult?: (data: { success: boolean; code: number }) => void;
  onError?: (error: string) => void;
};

export class ESPHomeAPI {
  private _ws: WebSocket | null = null;
  private _messageId = 0;
  private _pendingRequests = new Map<string, PendingRequest>();
  private _streamHandlers = new Map<string, StreamHandler>();
  private _eventSubscriptions = new Map<string, EventSubscriptionCallback>();
  private _serverInfo: ServerInfoMessage | null = null;
  private _connected = false;
  // Bumps every time the WS opens — i.e. on the initial connect
  // and on every reconnect after a drop. Per-device streams
  // (``subscribeDeviceReachability``) read this to detect that
  // ``_eventSubscriptions`` was cleared by ``_onClose`` and
  // resubscribe; the WS itself can't deliver a "reconnected"
  // signal to long-lived consumers any other way.
  private _connectionGeneration = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = 1000;
  private _intentionalDisconnect = false;
  private _connectPromise: {
    resolve: (info: ServerInfoMessage) => void;
    reject: (error: Error) => void;
  } | null = null;

  // Auth state. ``_authToken`` mirrors the value last accepted by the
  // server (or pulled from localStorage on (re)connect). ``_ready`` is
  // a deferred promise resolved either when the server replies
  // ``requires_auth: false``, or after a successful auth/login —
  // components that need to issue commands at startup ``await api.ready``
  // to avoid racing the auth gate.
  private _authToken: string | null = null;
  private _readyPromise: Promise<void> = Promise.resolve();
  private _readyResolve: (() => void) | null = null;

  // Callbacks for connection state changes
  onConnected?: (info: ServerInfoMessage) => void;
  onDisconnected?: () => void;
  /** Fired when the server requires auth and we don't have a usable
   *  stored token (or the stored token was rejected). The app shell
   *  uses this to surface the login form. */
  onAuthRequired?: () => void;

  get connected(): boolean {
    return this._connected;
  }

  /** Generation counter that increments on every successful WS open
   *  (initial connect *and* every reconnect). Long-lived per-stream
   *  consumers (the drawer's reachability subscription) compare
   *  against the value they captured at subscribe time and resub
   *  when it changes — ``_onClose`` clears every event listener,
   *  so without this signal a closed stream never recovers. */
  get connectionGeneration(): number {
    return this._connectionGeneration;
  }

  get serverInfo(): ServerInfoMessage | null {
    return this._serverInfo;
  }

  /** Resolves once the connection is fully ready to issue commands —
   *  i.e. ``requires_auth: false`` was reported, or auth/login
   *  succeeded. Components that need to fetch data on startup should
   *  ``await api.ready`` before calling other commands. */
  get ready(): Promise<void> {
    return this._readyPromise;
  }

  /** Replace ``ready`` with a fresh pending promise — but only when
   *  the previous one was already resolved. This keeps the same
   *  pending promise alive across the ``connect()`` → ``_onClose``
   *  → reconnect chain so callers that attached ``.then(...)`` during
   *  the disconnected window aren't stranded when the reconnect's
   *  ``connect()`` runs. */
  private _resetReady(): void {
    if (this._readyResolve !== null) return;
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  private _markReady(): void {
    if (this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
    }
  }

  // ─── Connection Management ────────────────────────────────

  /**
   * Connect to the WebSocket endpoint.
   * Resolves with the ServerInfoMessage on successful connection.
   */
  connect(): Promise<ServerInfoMessage> {
    if (this._connected && this._serverInfo) {
      return Promise.resolve(this._serverInfo);
    }

    // Every connect attempt has its own readiness window — pre-auth
    // commands shouldn't accidentally observe a still-resolved promise
    // from a previous (now-closed) connection.
    this._resetReady();

    return new Promise((resolve, reject) => {
      this._connectPromise = { resolve, reject };
      this._intentionalDisconnect = false;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${BASE_PATH}ws`;

      this._ws = new WebSocket(wsUrl);

      this._ws.addEventListener("message", (event) => {
        this._onMessage(event);
      });

      this._ws.addEventListener("error", () => {
        if (this._connectPromise) {
          this._connectPromise.reject(new Error("WebSocket connection failed"));
          this._connectPromise = null;
        }
      });

      this._ws.addEventListener("close", () => {
        this._onClose();
      });
    });
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this._intentionalDisconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._ws?.close();
    this._ws = null;
    this._connected = false;
  }

  private _onMessage(event: MessageEvent): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
      console.debug("[RECEIVED]", redactForLog(data));
    } catch {
      console.error("Invalid JSON from WebSocket");
      return;
    }

    // ServerInfoMessage — sent on connect, has server_version
    if ("server_version" in data) {
      this._serverInfo = data as unknown as ServerInfoMessage;
      this._connected = true;
      // Bump *before* firing ``onConnected`` so any handler that
      // immediately reads ``connectionGeneration`` (e.g. the
      // drawer's reachability reconcile via tick) sees the fresh
      // value rather than the previous one.
      this._connectionGeneration += 1;
      this._reconnectDelay = 1000;
      if (this._connectPromise) {
        this._connectPromise.resolve(this._serverInfo);
        this._connectPromise = null;
      }
      this.onConnected?.(this._serverInfo);
      this._handlePostServerInfo(this._serverInfo);
      return;
    }

    const messageId = data.message_id as string;
    if (!messageId) return;

    // ErrorMessage
    if ("error_code" in data) {
      const err = data as unknown as ErrorMessage;
      const pending = this._pendingRequests.get(messageId);
      if (pending) {
        this._pendingRequests.delete(messageId);
        pending.reject(new APIError(err.error_code, err.details));
      }
      const stream = this._streamHandlers.get(messageId);
      if (stream) {
        this._streamHandlers.delete(messageId);
        stream.onError?.(err.details || err.error_code);
      }
      return;
    }

    // EventMessage — push events or streaming output/result
    if ("event" in data) {
      const evt = data as unknown as EventMessage;

      // Event subscription push events (subscribe_events)
      const sub = this._eventSubscriptions.get(messageId);
      if (sub) {
        sub(evt.event, evt.data);
        return;
      }

      // Streaming command output/result
      const stream = this._streamHandlers.get(messageId);
      if (stream) {
        if (evt.event === "output") {
          stream.onOutput?.(evt.data as string);
        } else if (evt.event === "result") {
          this._streamHandlers.delete(messageId);
          stream.onResult?.(evt.data as { success: boolean; code: number });
        }
      }
      return;
    }

    // ResultMessage — command response
    if ("result" in data) {
      const result = data as unknown as ResultMessage;
      const pending = this._pendingRequests.get(messageId);
      if (pending) {
        this._pendingRequests.delete(messageId);
        pending.resolve(result.result);
      }
      return;
    }
  }

  /**
   * Run the auth dance immediately after the ServerInfoMessage lands.
   *
   * - If the server says ``requires_auth: false`` (no password
   *   configured, or the request came in via the trusted HA-ingress
   *   site) → mark the connection ready, no further work needed.
   * - If a stored token exists → try ``auth/login {token}``. On
   *   success the server returns a fresh token + sliding expiry; we
   *   persist it and mark ready. On any error the stored token is
   *   dropped and ``onAuthRequired`` fires so the app shell can
   *   surface the login form.
   * - If no stored token exists → fire ``onAuthRequired`` directly.
   *
   * Runs on every (re)connect, so a mid-session reconnect with a
   * still-valid token is transparent and a revoked token correctly
   * surfaces the login form.
   */
  private _handlePostServerInfo(info: ServerInfoMessage): void {
    if (!info.requires_auth) {
      this._markReady();
      return;
    }

    // Prefer the localStorage copy (it's "the most recent token we
    // know about" since ``setStoredToken`` runs on every successful
    // login), but fall back to the in-memory ``_authToken`` so private
    // mode / sandboxed iframes — where ``setStoredToken`` is silently
    // a no-op — don't drop the user back to the login form on every
    // reconnect.
    const token = getStoredToken() ?? this._authToken;
    if (!token) {
      this.onAuthRequired?.();
      return;
    }

    void this._tryStoredTokenLogin(token);
  }

  private async _tryStoredTokenLogin(token: string): Promise<void> {
    try {
      await this.login({ token });
    } catch {
      // Stored token rejected — wipe it and surface the login form.
      // The login() method already cleared in-memory + storage on the
      // not_authenticated path; rate-limited / unexpected errors land
      // here too, and the user retries with credentials.
      this.onAuthRequired?.();
    }
  }

  private _onClose(): void {
    const wasConnected = this._connected;
    this._connected = false;
    this._ws = null;

    // Park ``ready`` until the next successful connect+auth. Without
    // this, anyone awaiting it during the reconnect-backoff window
    // would resume against a closed socket and immediately hit
    // "WebSocket not connected".
    this._resetReady();

    // Reject all pending requests
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error("WebSocket connection closed"));
    }
    this._pendingRequests.clear();

    // Notify stream handlers
    for (const [, stream] of this._streamHandlers) {
      stream.onError?.("WebSocket connection closed");
    }
    this._streamHandlers.clear();

    // Clear event subscriptions (will re-subscribe on reconnect)
    this._eventSubscriptions.clear();

    if (wasConnected) {
      this.onDisconnected?.();
    }

    // Auto-reconnect unless intentionally disconnected
    if (!this._intentionalDisconnect) {
      const delay = this._reconnectDelay;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
      console.debug(`[WS] Reconnecting in ${delay}ms...`);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connect().catch(() => {
          // _onClose will fire again and schedule next retry
        });
      }, delay);
    }
  }

  // ─── Command Sending ──────────────────────────────────────

  private _nextMessageId(): string {
    return String(++this._messageId);
  }

  /**
   * Send a command and wait for the result.
   */
  async sendCommand<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
    timeout = 10000
  ): Promise<T> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const messageId = this._nextMessageId();
    const msg: CommandMessage = { command, message_id: messageId };
    if (args && Object.keys(args).length > 0) {
      msg.args = args;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(messageId);
        reject(new Error(`Command "${command}" timed out after ${timeout}ms`));
      }, timeout);

      this._pendingRequests.set(messageId, {
        resolve: (result: unknown) => {
          clearTimeout(timer);
          (resolve as (v: unknown) => void)(result);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      console.debug("[SENDING]", redactForLog(msg));
      this._ws!.send(JSON.stringify(msg));
    });
  }

  /**
   * Send a streaming command (compile, upload, logs, etc.).
   * Returns the message_id for cancellation.
   */
  sendStreamCommand(
    command: string,
    args: Record<string, unknown>,
    callbacks: StreamCallbacks
  ): string {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      callbacks.onError?.("WebSocket not connected");
      return "";
    }

    const messageId = this._nextMessageId();
    this._streamHandlers.set(messageId, callbacks);

    const msg: CommandMessage = { command, message_id: messageId, args };
    this._ws.send(JSON.stringify(msg));

    return messageId;
  }

  // ─── Auth ─────────────────────────────────────────────────

  /**
   * Authenticate the current connection.
   *
   * Two paths, mirroring the backend ``auth/login`` contract:
   * - Username + password (interactive sign-in form).
   * - Token replay (silent re-auth on (re)connect using a token
   *   persisted from a previous successful login).
   *
   * On success the returned token is persisted to localStorage and
   * cached on the API client so the next reconnect can replay it
   * silently. ``ready`` resolves so any callers awaiting it (the app
   * shell's ``_postAuth`` flow) can proceed.
   *
   * On ``not_authenticated`` the stored token is cleared — no point
   * trying it again. Other errors (rate limited, transport, ...)
   * leave storage untouched so the user can retry once the limit
   * window passes or the network recovers.
   */
  async login(
    credentials: { username: string; password: string } | { token: string }
  ): Promise<AuthLoginResult> {
    try {
      const result = await this.sendCommand<AuthLoginResult>(
        "auth/login",
        credentials as unknown as Record<string, unknown>
      );
      this._authToken = result.token;
      setStoredToken(result.token, result.expires_at);
      this._markReady();
      return result;
    } catch (err) {
      if (err instanceof APIError && err.errorCode === "not_authenticated") {
        this._authToken = null;
        clearStoredToken();
      }
      throw err;
    }
  }

  /**
   * Revoke the current session and drop the stored token.
   *
   * The backend closes the socket immediately after responding, which
   * triggers our auto-reconnect — the new connection will land on
   * ``requires_auth: true`` with no usable token, so the app shell
   * surfaces the login form. We don't proactively close here; letting
   * the backend drive the close keeps the flow simple.
   */
  async logout(): Promise<void> {
    try {
      await this.sendCommand("auth/logout");
    } finally {
      // Always wipe local state — even if the request failed (e.g.
      // network blip), the user's intent is "log me out". On
      // reconnect they'll be prompted to sign in again.
      this._authToken = null;
      clearStoredToken();
    }
  }

  // ─── Event Subscription ────────────────────────────────────

  /**
   * Subscribe to real-time push events from the backend.
   * The callback receives events for the lifetime of the connection.
   * Returns a promise that resolves once the subscription is confirmed.
   */
  async subscribeEvents(callback: EventSubscriptionCallback): Promise<void> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const messageId = this._nextMessageId();
    // Register event subscription before sending so we don't miss events
    this._eventSubscriptions.set(messageId, callback);

    const msg: CommandMessage = { command: "subscribe_events", message_id: messageId };
    this._ws.send(JSON.stringify(msg));

    // Wait for the {subscribed: true} result confirmation
    return new Promise<void>((resolve, reject) => {
      this._pendingRequests.set(messageId, {
        resolve: () => resolve(),
        reject,
      });
    });
  }

  /**
   * Subscribe to per-signal reachability events for one device.
   *
   * The drawer opens this stream while showing a single device so
   * the Reachability section can refresh "mDNS heard 12s ago, ping
   * 47s ago, MQTT 2 min ago, RTT 4 ms" without bloating the
   * broadcast ``subscribe_events`` channel for every other client.
   * The backend emits one initial ``reachability_state`` event,
   * then a fresh one whenever any signal updates for the
   * subscribed device. While subscribed AND the active source is
   * mDNS, the backend force-refreshes the A record every 60s.
   *
   * Returns a handle whose ``unsubscribe()`` sends
   * ``devices/stop_stream`` to detach the listener cleanly without
   * closing the shared WS. Unsubscribe is best-effort: errors are
   * swallowed since the per-stream task is cancelled by the WS
   * disconnect anyway.
   */
  async subscribeDeviceReachability(
    deviceName: string,
    callback: (state: ReachabilityStateEvent) => void,
  ): Promise<ReachabilitySubscription> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const messageId = this._nextMessageId();
    // Register before sending so we don't miss the initial
    // ``reachability_state`` event the backend emits inside its
    // ``send_initial`` callback. The handler in the WS dispatcher
    // forwards every event under this message_id through the
    // ``_eventSubscriptions`` map — same path ``subscribe_events``
    // uses, just filtered to a single device on the backend side.
    this._eventSubscriptions.set(messageId, (event, data) => {
      if (event === "reachability_state") {
        callback(data as ReachabilityStateEvent);
      }
    });

    const msg: CommandMessage = {
      command: "devices/subscribe_reachability",
      message_id: messageId,
      args: { device_name: deviceName },
    };
    this._ws.send(JSON.stringify(msg));

    // Wait for the {subscribed: true} confirmation. ``send_initial``
    // emits the initial event *before* the result, so by the time
    // this resolves the caller has already received the first
    // snapshot via the callback.
    //
    // On server error (NOT_FOUND for an unknown device, INVALID_ARGS,
    // INTERNAL_ERROR mid-handler) the await rejects via
    // ``_pendingRequests`` — but a non-responding backend (or a
    // proxy that drops the result frame while keeping the WS
    // open) would otherwise hang the await forever, leaking the
    // ``_pendingRequests`` *and* ``_eventSubscriptions`` entries
    // and pinning the drawer's "subscribed" flag so it never
    // retries. Match ``sendCommand``'s 10s timeout so the
    // failure mode is a typed reject the caller's catch can
    // handle. Connection-level drops still get blanket-cleared
    // by ``_onClose``.
    const SUBSCRIBE_TIMEOUT_MS = 10000;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pendingRequests.delete(messageId);
          reject(
            new Error(
              `subscribe_reachability timed out after ${SUBSCRIBE_TIMEOUT_MS}ms`,
            ),
          );
        }, SUBSCRIBE_TIMEOUT_MS);
        this._pendingRequests.set(messageId, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
      });
    } catch (err) {
      this._eventSubscriptions.delete(messageId);
      throw err;
    }

    return {
      unsubscribe: async () => {
        // Drop the callback synchronously so any in-flight event
        // queued after this point is silently discarded.
        this._eventSubscriptions.delete(messageId);
        // Fire-and-forget the stop_stream round-trip. The
        // backend's per-stream task is also cancelled by the WS
        // disconnect, so awaiting the result has no functional
        // value — and ``sendCommand`` carries a 10s default
        // timeout that would make ``unsubscribe()`` hang for
        // 10s on any non-responsive server. Swallow the
        // returned promise (and any rejection it produces) so
        // callers see the cleanup as essentially synchronous.
        this.sendCommand("devices/stop_stream", {
          stream_id: messageId,
        }).catch(() => {
          /* server hiccup or already-disconnected; ignore */
        });
      },
    };
  }

  // ─── Device Commands ──────────────────────────────────────

  /** List all configured and importable devices. */
  async listDevices(): Promise<DevicesResponse> {
    return this.sendCommand<DevicesResponse>("devices/list");
  }

  /** Trigger device state polling. */
  async getDeviceStates(): Promise<Record<string, never>> {
    return this.sendCommand("devices/get_states");
  }

  /**
   * Substring-search every configured device's raw YAML file.
   *
   * Backed by the backend's ``yaml/search`` command. Returns one
   * entry per matching device with up to 5 matches per file
   * (backend cap) and a backend default of 50 total matches
   * across the fleet. Empty / whitespace queries are
   * short-circuited by the backend (returns ``[]`` before walking
   * the fleet); the caller is expected to filter them out before
   * calling so the request shape stays a simple round trip the
   * dropdown can debounce. ``max_results`` and ``case_sensitive``
   * are server-controlled defaults — add them back to this
   * wrapper when a UI surface needs to override.
   */
  async searchYaml(args: { query: string }): Promise<YamlSearchHit[]> {
    return this.sendCommand<YamlSearchHit[]>("yaml/search", args);
  }

  /** Create a new device configuration. */
  async createDevice(args: {
    name: string;
    board_id?: string;
    config_type?: string;
    ssid?: string;
    psk?: string;
    file_content?: string;
  }): Promise<WizardResponse> {
    return this.sendCommand<WizardResponse>("devices/create", args);
  }

  /** Update device metadata. */
  async updateDevice(args: {
    name: string;
    friendly_name?: string;
    comment?: string;
    board_id?: string;
  }): Promise<UpdateDeviceResponse> {
    return this.sendCommand<UpdateDeviceResponse>("devices/update", args);
  }

  /** Rename a device via the ESPHome CLI (renames YAML file + hostname).
   *
   *  When the YAML validates, this kicks off a queued firmware
   *  ``RENAME`` job that compiles + OTA-installs + swaps the YAML —
   *  the returned ``job`` is what the caller follows in the
   *  command-dialog so the user sees streaming output.
   *
   *  When the YAML doesn't validate (typical for a freshly-created
   *  empty config), the backend does a pure file-level rename inline
   *  and returns ``job: null``.
   */
  async renameDevice(
    configuration: string,
    newName: string
  ): Promise<{ configuration: string; job: FirmwareJob | null }> {
    return this.sendCommand<{ configuration: string; job: FirmwareJob | null }>(
      "devices/rename",
      { configuration, new_name: newName },
      60000
    );
  }

  /** Clone a device — copy the source YAML under a fresh hostname.
   *
   *  The clone gets:
   *  - a fresh ``esphome.name`` (mDNS hostname / API endpoint),
   *  - a fresh ``friendly_name`` (defaults to the slug-derived form
   *    of *newName*; pass ``newFriendlyName`` to override),
   *  - a freshly-generated ``api.encryption.key`` (fleet members
   *    don't share encryption material).
   *
   *  Indirections (``!secret api_key`` / ``${api_key}``) are
   *  preserved as-is — they point at content the clone shares with
   *  the source on disk, and rewriting them would silently desync.
   *
   *  Returns the new configuration filename. ``CommandError(INVALID_ARGS)``
   *  surfaces user-correctable failures (collision, empty / equal
   *  name, missing source) so the dialog can show a specific
   *  message.
   */
  async cloneDevice(
    configuration: string,
    newName: string,
    newFriendlyName?: string
  ): Promise<{ configuration: string }> {
    return this.sendCommand<{ configuration: string }>("devices/clone", {
      configuration,
      new_name: newName,
      ...(newFriendlyName !== undefined
        ? { new_friendly_name: newFriendlyName }
        : {}),
    });
  }

  /** Rewrite ``esphome.friendly_name`` in the device YAML in place.
   *
   *  The dashboard's friendly name and the running device's mDNS
   *  broadcast both come from this YAML field, so an edit has to
   *  land in the YAML (not just a sidecar) for the dashboard label
   *  and the device's announced name to stay in sync. Backend
   *  reuses the same YAML rewriter the clone path is built on:
   *  substitution-aware (``${friendly_name}`` redirects through
   *  the substitutions block) and safe on YAML-special characters
   *  (``Bedroom #2`` round-trips correctly).
   *
   *  Returns ``{configuration, rewritten}``. ``rewritten=false``
   *  signals an idempotent no-op (user submitted the same value
   *  the leaf already had); the caller should skip a follow-up
   *  install in that case.
   *
   *  ``CommandError(INVALID_ARGS)`` surfaces user-correctable
   *  failures (blank name, missing device, package-driven
   *  friendly_name with no inline leaf) so the dialog can show a
   *  specific message.
   */
  async editFriendlyName(
    configuration: string,
    newFriendlyName: string
  ): Promise<{ configuration: string; rewritten: boolean }> {
    return this.sendCommand<{ configuration: string; rewritten: boolean }>(
      "devices/edit_friendly_name",
      { configuration, new_friendly_name: newFriendlyName }
    );
  }

  /** Delete a device and all associated files. */
  async deleteDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/delete", { configuration });
  }

  /** Delete multiple devices at once. Returns per-device results. */
  async deleteBulkDevices(configurations: string[]): Promise<BulkActionResult[]> {
    return this.sendCommand<BulkActionResult[]>("devices/delete_bulk", {
      configurations,
    });
  }

  /**
   * Archive a device — soft-delete that moves the YAML to
   * ``<config_dir>/archive/`` and wipes the per-device build dir.
   * Reversible via ``unarchiveDevice``.
   */
  async archiveDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/archive", { configuration });
  }

  /**
   * Archive multiple devices at once. Returns per-device results
   * with the same shape as ``deleteBulkDevices`` so the dashboard
   * can route both bulk flows through one toast handler.
   */
  async archiveBulkDevices(configurations: string[]): Promise<BulkActionResult[]> {
    return this.sendCommand<BulkActionResult[]>("devices/archive_bulk", {
      configurations,
    });
  }

  /**
   * Restore an archived device's YAML to the active config_dir.
   * Errors with INVALID_ARGS if an active config with the same
   * filename already exists — the dialog should prompt for
   * resolution rather than blindly clobbering.
   */
  async unarchiveDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/unarchive", { configuration });
  }

  /** List archived devices for the archived-devices dialog. */
  async listArchivedDevices(): Promise<ArchivedDevice[]> {
    return this.sendCommand<ArchivedDevice[]>("devices/list_archived");
  }

  /**
   * Permanently delete an archived device's YAML and its sidecars.
   * The companion to ``archiveDevice`` for "I really don't want
   * this back" — irreversible. Surfaces NOT_FOUND if the archive
   * entry is gone.
   */
  async deleteArchivedDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/delete_archived", { configuration });
  }

  /** Get device YAML config. */
  async getConfig(configuration: string): Promise<string> {
    return this.sendCommand<string>("devices/get_config", { configuration });
  }

  /** Save device YAML config. */
  async updateConfig(configuration: string, content: string): Promise<void> {
    await this.sendCommand("devices/update_config", { configuration, content });
  }

  /**
   * Resolve the Native API encryption key for a device.
   *
   * Backend reads the YAML through ESPHome's loader so ``!secret`` /
   * ``!include`` / packages all resolve like a real compile. Empty
   * string when the device has no ``api: encryption:`` block, the
   * resolution failed, or the key isn't a string. Callers use the
   * empty value as the "open the editor and check" signal.
   */
  async getApiKey(configuration: string): Promise<string> {
    // ``sendCommand`` resolves ``unknown`` — guard the shape so a
    // malformed payload (number / object / nullish) can't sneak past
    // the dialog's string-only assumptions and surface as a runtime
    // crash. The empty string is the same "no key here" signal the
    // backend already produces for unencrypted / unparseable configs.
    const result = await this.sendCommand<{ key: unknown }>("devices/get_api_key", {
      configuration,
    });
    return typeof result?.key === "string" ? result.key : "";
  }

  /**
   * Add a component to a device config.
   *
   * Nested values mirror the YAML structure: pass them as nested dicts
   * inside `fields` (e.g. `{ pin: 5, temperature: { name: "T" } }`).
   */
  async addComponent(
    configuration: string,
    args: {
      component_id: string;
      fields?: Record<string, unknown>;
    }
  ): Promise<AddComponentResponse> {
    return this.sendCommand<AddComponentResponse>("devices/add_component", {
      configuration,
      ...args,
    });
  }

  /** Import/adopt a discovered device. */
  async importDevice(args: {
    name: string;
    project_name?: string;
    package_import_url?: string;
    friendly_name?: string;
    encryption?: string;
  }): Promise<{ configuration: string }> {
    return this.sendCommand("devices/import", args);
  }

  /** Ignore/unignore a discovered device. */
  async ignoreDevice(name: string, ignore: boolean): Promise<void> {
    await this.sendCommand("devices/ignore", { name, ignore });
  }

  /** Replace this device's label assignments wholesale.
   *
   *  ``labelIds`` is the new full list — pass ``[]`` to clear every
   *  assignment. Unknown ids are rejected as ``invalid_args``; the
   *  catalog check runs inside the same metadata transaction as the
   *  write so a concurrent ``labels/delete`` cascade can't leave a
   *  dangling reference. The returned ``ConfiguredDevice`` already
   *  reflects the freshly-loaded labels, so callers can update local
   *  state without waiting for the ``device_updated`` event. */
  async setDeviceLabels(
    configuration: string,
    labelIds: string[],
  ): Promise<ConfiguredDevice> {
    return this.sendCommand<ConfiguredDevice>("devices/set_labels", {
      configuration,
      label_ids: labelIds,
    });
  }

  // ─── Labels Commands ──────────────────────────────────────

  /** Return every label in the global catalog. */
  async listLabels(): Promise<Label[]> {
    return this.sendCommand<Label[]>("labels/list");
  }

  /** Create a new label. ``name`` 1-50 chars, unique
   *  case-insensitively. ``color`` is ``#rrggbb`` (lowercased on
   *  save) or ``null`` / omitted for "no explicit color". */
  async createLabel(args: {
    name: string;
    color?: string | null;
  }): Promise<Label> {
    return this.sendCommand<Label>("labels/create", args);
  }

  /** Rename and / or recolor a label. Pass ``color: null`` to clear
   *  the color; omit ``color`` from the request to leave it
   *  unchanged. At least one of ``name`` / ``color`` is required. */
  async updateLabel(args: {
    label_id: string;
    name?: string;
    color?: string | null;
  }): Promise<Label> {
    return this.sendCommand<Label>("labels/update", args);
  }

  /** Delete a label. The backend cascades through every device
   *  assignment in a single metadata transaction; affected devices
   *  fire their own ``device_updated`` events as the live
   *  ``Device`` objects reload, and a ``label_deleted`` event lands
   *  last so consumers can drop the catalog entry. */
  async deleteLabel(labelId: string): Promise<void> {
    await this.sendCommand("labels/delete", { label_id: labelId });
  }

  // ─── Streaming Commands (per-connection) ───────────────────

  /**
   * Validate a device configuration (streaming, not queued).
   *
   * ``options.showSecrets`` passes through to the backend as
   * ``--show-secrets`` on the underlying ``esphome config`` call.
   * Default off — resolved ``!secret`` values appear as
   * ``<removed>`` until the user explicitly opts in via the toolbar
   * toggle in the validate output dialog.
   */
  validate(
    configuration: string,
    callbacks: StreamCallbacks,
    options: { showSecrets?: boolean } = {}
  ): string {
    const payload: Record<string, unknown> = { configuration };
    if (options.showSecrets) {
      payload.show_secrets = true;
    }
    return this.sendStreamCommand("devices/validate", payload, callbacks);
  }

  /** Stream logs from a device (streaming, not queued). */
  logs(
    configuration: string,
    port: string,
    callbacks: StreamCallbacks,
    options: { noStates?: boolean } = {}
  ): string {
    const payload: Record<string, unknown> = { configuration, port };
    if (options.noStates) {
      payload.no_states = true;
    }
    return this.sendStreamCommand("devices/logs", payload, callbacks);
  }

  /**
   * Cancel a previously-issued streaming command (validate or logs).
   *
   * The backend kills the underlying subprocess and the streaming task
   * ends in CANCELLED state — no further `output`/`result` events are
   * sent for that stream. Returns once the backend confirms.
   *
   * The local handler for `streamId` is dropped synchronously so any
   * already-in-flight `output` events (or a misbehaving backend that
   * keeps sending) won't reach the caller after the stop, and the
   * `_streamHandlers` entry doesn't leak when the cancelled task
   * never emits a terminal `result` event.
   */
  async stopStream(streamId: string): Promise<{ cancelled: boolean }> {
    this._streamHandlers.delete(streamId);
    return this.sendCommand<{ cancelled: boolean }>("devices/stop_stream", {
      stream_id: streamId,
    });
  }

  /** Follow a job's output: historical lines + live stream until completion. */
  firmwareFollowJob(jobId: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand("firmware/follow_job", { job_id: jobId }, callbacks);
  }

  /**
   * Subscribe to lifecycle, output, and progress events for every job.
   *
   * Stays open for the connection's lifetime — there's no per-subscription
   * cancel on the backend. Events delivered to `callback`:
   *  - `snapshot` (FirmwareJob) — replayed on subscribe for each
   *    non-terminal job, when `snapshot` arg is `true` (default).
   *  - `job_queued` / `job_started` / `job_completed` / `job_failed`
   *    / `job_cancelled` — payload is the full FirmwareJob.
   *  - `job_output` — `{ job_id, line }`.
   *  - `job_progress` — `{ job_id, progress }`.
   */
  firmwareFollowJobs(callback: EventSubscriptionCallback, snapshot = true): string {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    const messageId = this._nextMessageId();
    this._eventSubscriptions.set(messageId, callback);
    const msg: CommandMessage = {
      command: "firmware/follow_jobs",
      message_id: messageId,
      args: { snapshot },
    };
    this._ws.send(JSON.stringify(msg));
    return messageId;
  }

  // ─── Firmware Commands (job queue) ────────────────────────

  /** Queue a compile job. */
  async firmwareCompile(configuration: string): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/compile", { configuration });
  }

  /** Queue an upload job. */
  async firmwareUpload(configuration: string, port = ""): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/upload", { configuration, port });
  }

  /** Queue a compile+upload job (defaults to OTA).
   *
   *  ``forceLocal=true`` bypasses the offloader-side scheduler
   *  decision and runs the install on the local CPU regardless of
   *  paired build servers — used by the install dialog's "Build
   *  locally instead" override link when the operator wants to
   *  opt out of the transparent REMOTE routing for one install. */
  async firmwareInstall(
    configuration: string,
    port = "OTA",
    forceLocal = false,
  ): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/install", {
      configuration,
      port,
      force_local: forceLocal,
    });
  }

  /** Queue a clean job. */
  async firmwareClean(configuration: string): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/clean", { configuration });
  }

  /** Queue a reset-build-environment job (wipes the toolchain cache). */
  async firmwareResetBuildEnv(): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/reset_build_env");
  }

  /** Queue compile for multiple devices. */
  async firmwareCompileBulk(configurations: string[]): Promise<FirmwareJob[]> {
    return this.sendCommand<FirmwareJob[]>("firmware/compile_bulk", { configurations });
  }

  /** Queue install for multiple devices. */
  async firmwareInstallBulk(
    configurations: string[],
    port = "OTA"
  ): Promise<FirmwareJob[]> {
    return this.sendCommand<FirmwareJob[]>("firmware/install_bulk", {
      configurations,
      port,
    });
  }

  /** List jobs, optionally filtered. */
  async firmwareGetJobs(args?: {
    status?: string;
    configuration?: string;
  }): Promise<FirmwareJob[]> {
    return this.sendCommand<FirmwareJob[]>("firmware/get_jobs", args);
  }

  /** Get a single job with full output. */
  async firmwareGetJob(jobId: string): Promise<FirmwareJob | null> {
    return this.sendCommand<FirmwareJob | null>("firmware/get_job", { job_id: jobId });
  }

  /** Cancel a queued job. */
  async firmwareCancel(jobId: string): Promise<void> {
    await this.sendCommand("firmware/cancel", { job_id: jobId });
  }

  /** Remove finished jobs. */
  async firmwareClear(status?: string): Promise<void> {
    await this.sendCommand("firmware/clear", status ? { status } : undefined);
  }

  /** List available firmware binaries after compile. */
  async firmwareGetBinaries(configuration: string): Promise<FirmwareBinary[]> {
    return this.sendCommand<FirmwareBinary[]>("firmware/get_binaries", { configuration });
  }

  /** Download a compiled firmware binary as base64. */
  async firmwareDownload(
    configuration: string,
    file: string,
    compressed = false
  ): Promise<FirmwareDownload> {
    return this.sendCommand<FirmwareDownload>("firmware/download", {
      configuration,
      file,
      compressed,
    });
  }

  // ─── Board Commands ───────────────────────────────────────

  /** Get a single board by ID. */
  async getBoard(boardId: string): Promise<BoardCatalogEntry | null> {
    return this.sendCommand("boards/get_board", { board_id: boardId });
  }

  /** Get boards with optional filtering, search, and pagination. */
  async getBoards(args?: {
    query?: string;
    platform?: string;
    variant?: string;
    tag?: string;
    offset?: number;
    limit?: number;
  }): Promise<PagedBoardsResponse> {
    return this.sendCommand<PagedBoardsResponse>("boards/get_boards", args);
  }

  // ─── Component Commands ───────────────────────────────────

  /**
   * Get a single component by ID.
   *
   * Pass `platform` (the device's target platform, e.g. "esp32",
   * "esp8266") to have the backend resolve any per-platform
   * `cv.SplitDefault` fields into a single `default_value`. Pass
   * `boardId` to additionally narrow board-level constraints. Omit
   * both when querying the generic catalog.
   */
  async getComponent(
    componentId: string,
    platform?: string,
    boardId?: string
  ): Promise<ComponentCatalogEntry | null> {
    return this.sendCommand("components/get_component", {
      component_id: componentId,
      ...(platform ? { platform } : {}),
      ...(boardId ? { board_id: boardId } : {}),
    });
  }

  /**
   * Get components with optional filtering, search, and pagination.
   *
   * `platform` works the same as in `getComponent` — pass the device's
   * target platform to have per-platform defaults pre-resolved.
   */
  async getComponents(args?: {
    query?: string;
    /** Single category or list — list matches if the component's
     *  category equals any value (logical OR). */
    category?: string | string[];
    /** Inverse of ``category``. List of categories to hide — used by
     *  the regular component selector to drop entries that belong to
     *  the dedicated "Add core configuration" dialog. */
    exclude_category?: string | string[];
    platform?: string;
    board_id?: string;
    offset?: number;
    limit?: number;
  }): Promise<PagedComponentsResponse> {
    return this.sendCommand<PagedComponentsResponse>("components/get_components", args);
  }

  /**
   * Map of integration name → esphome.io docs URL for every
   * loaded-integration name we can resolve. Names with no docs page
   * are simply absent from the map; the dashboard renders those as
   * plain text. Fetched once at app load — the dataset only refreshes
   * with a backend release.
   *
   * The WS layer doesn't enforce a shape, so we filter the payload to
   * the ``{string: string}`` contract here: anything that isn't a
   * plain object is replaced with ``{}``, and entries with non-string
   * keys/values are dropped. Consumers can rely on the result being
   * safe to spread into a context without further validation.
   */
  async getIntegrationDocs(): Promise<Record<string, string>> {
    const raw = await this.sendCommand<unknown>("components/get_integration_docs");
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof key === "string" && typeof value === "string" && value) {
        result[key] = value;
      }
    }
    return result;
  }

  // ─── Config Commands ──────────────────────────────────────

  /** Get ESPHome and server version. */
  async getVersion(): Promise<{ server_version: string; esphome_version: string }> {
    return this.sendCommand("config/version");
  }

  /** List available serial ports. */
  async getSerialPorts(): Promise<SerialPort[]> {
    return this.sendCommand<SerialPort[]>("config/serial_ports");
  }

  /**
   * Detect what's plugged into a server-side serial port. Runs
   * esptool chip-id + a best-effort read of the IDF app descriptor
   * so the wizard's server-serial branch can auto-route on factory
   * firmware the same way WebSerial does.
   */
  async detectChip(port: string): Promise<DetectChipResult> {
    return this.sendCommand<DetectChipResult>("config/detect_chip", { port });
  }

  /** Get user preferences. */
  async getPreferences(): Promise<UserPreferences> {
    return this.sendCommand<UserPreferences>("config/get_preferences");
  }

  /** Update user preferences (partial — only provided fields are changed). */
  async updatePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    return this.sendCommand<UserPreferences>(
      "config/set_preferences",
      prefs as Record<string, unknown>
    );
  }

  /** Get secret key names. */
  async getSecretKeys(): Promise<string[]> {
    return this.sendCommand<string[]>("config/get_secrets");
  }

  /**
   * Onboarding state — current version, what the user has
   * acknowledged, and per-step ``pending`` / ``done`` status. The
   * dashboard hits this on app load to decide whether to surface
   * the setup wizard and whether to show the secrets-menu badge.
   */
  async getOnboardingState(): Promise<OnboardingState> {
    return this.sendCommand<OnboardingState>("onboarding/get_state");
  }

  /**
   * Save Wi-Fi credentials into the user's ``secrets.yaml``. The
   * backend validates against ESPHome's own length limits
   * (32 char SSID, 64 char password) and surfaces violations as
   * ``CommandError(INVALID_ARGS)`` for the UI to render.
   */
  async setOnboardingWifi(
    ssid: string,
    password: string,
  ): Promise<OnboardingState> {
    return this.sendCommand<OnboardingState>(
      "onboarding/set_wifi_credentials",
      { ssid, password },
    );
  }

  /**
   * Mark the current onboarding flow as acknowledged. Called when
   * the user explicitly closes the wizard (either after saving
   * credentials or after declining — e.g. an Ethernet-only user
   * who'll never set Wi-Fi). The badge in the secrets menu stays
   * if the underlying data is still un-configured; this only
   * stops the wizard dialog from re-popping until a future
   * onboarding-version bump.
   */
  async markOnboardingAcknowledged(): Promise<OnboardingState> {
    return this.sendCommand<OnboardingState>("onboarding/mark_acknowledged");
  }

  /**
   * Get the receiver-side remote-build settings.
   *
   * Phase 2 of issue #106 — only 'enabled' is exposed; phase 3+
   * adds artifact-retention TTL, the identity fingerprint, and
   * the rest of the "Remote builder" Settings section.
   */
  async getRemoteBuildSettings(): Promise<RemoteBuildSettings> {
    return this.sendCommand<RemoteBuildSettings>("remote_build/get_settings");
  }

  /**
   * Persist the receiver-side remote-build settings.
   *
   * `cleanup_ttl_seconds` is optional; omit (or pass `undefined`)
   * to preserve the existing value. The backend's
   * `remote_build/set_settings` handler validates it in
   * [`CLEANUP_TTL_MIN_SECONDS`, `CLEANUP_TTL_MAX_SECONDS`] and
   * rejects with `INVALID_ARGS` outside that range; the
   * settings dialog clamps client-side before the call, but
   * the validator is the load-bearing gate.
   */
  async setRemoteBuildSettings(args: {
    enabled: boolean;
    cleanup_ttl_seconds?: number;
  }): Promise<RemoteBuildSettings> {
    return this.sendCommand<RemoteBuildSettings>(
      "remote_build/set_settings",
      args
    );
  }

  /**
   * Get the offloader-side remote-build settings (7b).
   *
   * Bundles the master ``remote_builds_enabled`` toggle with
   * the pairings list so the Settings UI's first paint reads
   * everything it needs from one round-trip. Live updates
   * still ride on ``subscribe_events`` —
   * ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` /
   * ``OFFLOADER_PAIRING_ENABLED_CHANGED`` events fire after
   * the matching setter mutates state, so the UI doesn't have
   * to re-fetch.
   */
  async getOffloaderRemoteBuildSettings(): Promise<OffloaderRemoteBuildSettings> {
    return this.sendCommand<OffloaderRemoteBuildSettings>(
      "remote_build/get_offloader_settings"
    );
  }

  /**
   * Flip the offloader-side master "Remote builds enabled"
   * toggle (7b).
   *
   * When set to `false`, the backend's ``pick_build_path``
   * short-circuits every install to LOCAL; paired peer-link
   * sessions stay open and the Send-builds power-user dialog
   * still works — only the implicit auto-route is gated.
   * Strict boolean validation on the backend rejects truthy
   * non-booleans (the string ``"false"`` would otherwise
   * coerce to `true` and persist the opposite of operator
   * intent on a security-relevant switch).
   */
  async setOffloaderRemoteBuildSettings(args: {
    remote_builds_enabled: boolean;
  }): Promise<OffloaderRemoteBuildSettings> {
    return this.sendCommand<OffloaderRemoteBuildSettings>(
      "remote_build/set_offloader_settings",
      args
    );
  }

  /**
   * Flip one pairing's per-row enable switch (7b).
   *
   * When ``enabled=false``, the backend's ``pick_build_path``
   * walks past this row and looks for the next eligible
   * APPROVED + connected + idle pairing. The peer-link session
   * stays open and the Send-builds manual-dispatch path
   * against this row still works. Unknown ``pin_sha256``
   * rejects with ``ErrorCode.NOT_FOUND`` — a stale UI flipping
   * a switch for a pairing the operator just unpaired on
   * another tab gets a clean error, not a switch state that
   * doesn't match anything.
   */
  async setOffloaderPairingEnabled(args: {
    pin_sha256: string;
    enabled: boolean;
  }): Promise<PairingSummary> {
    return this.sendCommand<PairingSummary>(
      "remote_build/set_pairing_enabled",
      args
    );
  }

  /**
  // Note: there's no ``listRemoteBuildHosts`` /
  // ``addRemoteBuildManualHost`` / ``removeRemoteBuildManualHost``
  // wrapper. mDNS-discovered hosts ship through
  // ``subscribe_events``'s ``initial_state.hosts`` field at
  // subscribe time + the two live events
  // (``REMOTE_BUILD_HOST_ADDED`` / ``REMOTE_BUILD_HOST_REMOVED``)
  // drive every mutation. Manual-host entries were dropped
  // entirely in lockstep with the backend rip-out — the
  // offloader-side pair flow accepts a typed hostname / port
  // directly via ``request_pair`` without an intermediate
  // "save manual host" step.

  // ─── Remote build: receiver-side pairing inbox (phase 4a-r1) ──

  // Note: there's no ``listRemoteBuildPeers`` wrapper. The
  // receiver-side peer list (PENDING + APPROVED) ships through
  // ``subscribe_events``'s ``initial_state.peers`` field at
  // subscribe time + the three live events
  // (``REMOTE_BUILD_PAIR_REQUEST_RECEIVED`` /
  // ``REMOTE_BUILD_PAIR_STATUS_CHANGED``) drive every mutation.
  // A separate ``list_peers`` snapshot read would be a redundant
  // round-trip on the WS the frontend already has open.

  /**
   * Promote a PENDING peer to APPROVED.
   *
   * The receiver-side admin clicks Accept on a row in the
   * Pairing requests inbox; the call promotes the in-memory
   * row to a persisted ``StoredPeer``, fires
   * ``remote_build_pair_status_changed`` with
   * ``status="approved"``, and wakes any offloader currently
   * long-polling ``intent="pair_status"`` against this
   * ``dashboard_id``. Unknown ``dashboard_id`` rejects with
   * ``ErrorCode.NOT_FOUND``.
   */
  async approveRemoteBuildPeer(args: {
    dashboard_id: string;
  }): Promise<RemoteBuildSettings> {
    return this.sendCommand<RemoteBuildSettings>(
      "remote_build/approve_peer",
      args
    );
  }

  /**
   * Drop a peer row by ``dashboard_id``.
   *
   * Works for both PENDING (in-memory) and APPROVED (persisted)
   * rows. Fires ``remote_build_pair_status_changed`` with
   * ``status="removed"`` for either case so any offloader
   * long-polling pair_status sees the cancellation. Unknown
   * ``dashboard_id`` rejects with ``ErrorCode.NOT_FOUND``.
   */
  async removeRemoteBuildPeer(args: {
    dashboard_id: string;
  }): Promise<RemoteBuildSettings> {
    return this.sendCommand<RemoteBuildSettings>(
      "remote_build/remove_peer",
      args
    );
  }

  /**
   * Open or close the pairing window for the calling WS client.
   *
   * The pairing window narrows when ``intent="pair_request"``
   * Noise frames are accepted: only while at least one client
   * has called this with ``open: true`` and is keeping the
   * extend timestamp fresh. Refcounted across clients with a
   * 5-minute idle timeout; a graceful ``open: false`` removes
   * just the calling client (other tabs / users still keep the
   * window open if any of them is extending). Fires
   * ``remote_build_pairing_window_changed`` on transitions and
   * on every successful ``open: true`` extend.
   *
   * The frontend's Pairing requests screen calls ``open: true``
   * on mount + on each user-activity tick (debounced to once
   * per 30s on the wire), and ``open: false`` on unmount.
   */
  async setRemoteBuildPairingWindow(args: {
    open: boolean;
  }): Promise<PairingWindowState> {
    return this.sendCommand<PairingWindowState>(
      "remote_build/set_pairing_window",
      args
    );
  }

  // ─── Remote build: offloader-side pair flow (phase 4a-o) ──

  /**
   * Open a brief Noise XX WS to the receiver and capture its
   * pin for OOB-display.
   *
   * The offloader runs ``intent="preview"`` to capture the
   * receiver's static X25519 pubkey from the Noise handshake
   * transcript before committing to pair. The frontend renders
   * the returned ``pin_sha256`` for the user to OOB-verify
   * against the receiver's "Build server" Settings card; only
   * after that confirmation does the offloader call
   * {@link requestRemoteBuildPair}. Read-only on the receiver
   * (no state mutated). Transport / handshake / decode failures
   * surface as ``ErrorCode.UNAVAILABLE``.
   */
  async previewRemoteBuildPair(args: {
    hostname: string;
    port: number;
  }): Promise<{ pin_sha256: string }> {
    return this.sendCommand<{ pin_sha256: string }>(
      "remote_build/preview_pair",
      args
    );
  }

  /**
   * Send ``intent="pair_request"`` and persist a local
   * ``StoredPairing`` row.
   *
   * Re-handshakes the receiver (defends against TOCTOU between
   * preview and confirm) and sends ``{label: offloader_label,
   * dashboard_id}`` in the encrypted msg3 payload. The
   * receiver's response decides what state the local row lands
   * in: PENDING (typical first pair, awaiting admin Accept) or
   * APPROVED (re-pair against existing trust the receiver still
   * remembers).
   *
   * Two distinct labels because the offloader-side and
   * receiver-side rows mean different things:
   * ``receiver_label`` is the offloader's local name for the
   * receiver (lands on the offloader's ``StoredPairing.label``);
   * ``offloader_label`` is the offloader's self-identification
   * sent to the receiver in msg3 for *their* pairing-requests
   * inbox.
   *
   * Errors:
   * - ``ErrorCode.PRECONDITION_FAILED`` — pin mismatch (TOCTOU
   *   between preview and confirm) or receiver-side REJECTED.
   * - ``ErrorCode.NO_PAIRING_WINDOW`` — receiver's pairing
   *   window is closed; UI should prompt the user to ask the
   *   receiving dashboard's admin to open the Pairing requests
   *   screen.
   * - ``ErrorCode.UNAVAILABLE`` — transport / handshake / decode
   *   failure.
   * - ``ErrorCode.INVALID_ARGS`` — host / port / pin / label
   *   shape rejection.
   */
  async requestRemoteBuildPair(args: {
    hostname: string;
    port: number;
    pin_sha256: string;
    receiver_label: string;
    offloader_label: string;
  }): Promise<PairingSummary> {
    return this.sendCommand<PairingSummary>("remote_build/request_pair", args);
  }

  /**
   * Drop the local pairing row identified by *pin_sha256*.
   *
   * Idempotent — returns ``{removed: false}`` when no row
   * matches. Cancels the row's pair-status listener task if
   * any (the open Noise WS to the receiver closes promptly
   * without waiting on disk I/O). Fires
   * ``offloader_pair_status_changed`` with ``status="removed"``
   * so other tabs / clients on the global ``subscribe_events``
   * stream see the removal.
   *
   * 4a-o part 6 changed the WS arg from ``hostname / port`` to
   * ``pin_sha256``: the offloader's controller now keys
   * pairings on the receiver's stable cryptographic identity,
   * so the lookup arg follows. Every ``PairingSummary`` row the
   * frontend renders carries ``pin_sha256``, so the UI
   * passes that value directly without needing a host/port
   * round-trip.
   *
   * Receiver-side state is NOT notified — the receiver's
   * ``StoredPeer`` row stays until the receiver admin clicks
   * Remove on their own inbox; that's the receiver's ownership
   * concern. Phase 8's re-auth wizard surfaces the
   * "stale on receiver, removed locally" case as a UI
   * affordance for the receiver-side admin.
   */
  async unpairRemoteBuild(args: {
    pin_sha256: string;
  }): Promise<{ removed: boolean }> {
    return this.sendCommand<{ removed: boolean }>("remote_build/unpair", args);
  }

  /**
   * Manually rebind a paired receiver onto new (hostname, port) coords (phase 8b).
   *
   * Frontend-only fallback for the cases the 4a-o part 7
   * mDNS auto-rebind can't catch: cross-subnet receivers (no
   * mDNS path), mDNS disabled on the receiver's host, the
   * receiver moved to a hostname the offloader's network can
   * resolve but mDNS doesn't broadcast.
   *
   * Backend runs a one-shot ``peer_link_preview_pair`` probe
   * at the new coords to verify the endpoint is reachable
   * AND answers with the same pin the row was paired against.
   * On match: mutates the stored coords in place, cancels the
   * stale ``PeerLinkClient``, spawns a fresh one against the
   * new coords, fires ``offloader_pair_endpoint_rebound``,
   * and returns the updated ``PairingSummary``. On mismatch /
   * unreachable / race: leaves the stored row untouched and
   * raises a typed error.
   *
   * Errors from the WS layer:
   * - INVALID_ARGS: pin / hostname / port shape error.
   * - NOT_FOUND: no pairing for this pin, or the pairing was
   *   replaced mid-probe by a concurrent unpair / re-pair.
   * - PRECONDITION_FAILED: pairing isn't APPROVED, the
   *   offloader-side identity hasn't loaded yet, the new coords
   *   match the current ones (no-op edit), or the probe
   *   answered with a different pin (different identity at the
   *   new endpoint — re-pair through the regular flow if you
   *   actually want to switch identities).
   * - UNAVAILABLE: probe transport / handshake failure (new
   *   endpoint unreachable). Retry once the underlying
   *   connectivity recovers.
   */
  async editRemoteBuildPairingEndpoint(args: {
    pin_sha256: string;
    hostname: string;
    port: number;
  }): Promise<PairingSummary> {
    return this.sendCommand<PairingSummary>(
      "remote_build/edit_pairing_endpoint",
      args,
    );
  }

  /**
   * Dispatch a build to a paired receiver behind pin_sha256.
   *
   * Bundles the YAML + every referenced file (includes,
   * secrets, fonts, images) on the offloader, streams the
   * tarball over the live peer-link Noise session, and
   * returns the receiver's submit_job_ack. Live job
   * lifecycle + per-line stdout / stderr arrive
   * asynchronously through OFFLOADER_JOB_STATE_CHANGED /
   * OFFLOADER_JOB_OUTPUT events on the subscribe_events
   * stream tagged with the same job_id this returns.
   *
   * target is one of "compile" (build firmware artefacts on
   * the receiver, no flash) or "upload" (build then OTA-
   * upload to the device, like the local Install action).
   *
   * Errors from the WS layer:
   * - INVALID_ARGS: pin / target / configuration shape
   *   error, or bundle build failed (the receiver's
   *   validator diagnostic is in the message verbatim).
   * - NOT_FOUND: no pairing for this pin, or the YAML is
   *   missing from config_dir.
   * - PRECONDITION_FAILED: pairing isn't APPROVED, or the
   *   peer-link session isn't currently live (orphaned,
   *   unreachable, mid-reconnect).
   * - UNAVAILABLE: ack timeout, or the session died
   *   mid-flow.
   *
   * On accepted: false the receiver actively rejected the
   * job (queue full, manifest unsupported, hash mismatch);
   * reason carries the structured rejection code.
   *
   * Phase 5c-3 backend, 5c-4 frontend.
   */
  async submitRemoteBuildJob(args: {
    pin_sha256: string;
    configuration: string;
    target: RemoteBuildSubmitTarget;
  }): Promise<{ job_id: string; accepted: boolean; reason?: string }> {
    return this.sendCommand<{
      job_id: string;
      accepted: boolean;
      reason?: string;
    }>("remote_build/submit_job", args);
  }

  /**
   * Send a cooperative cancel for a remote build job (phase 5d).
   *
   * Routes through ``remote_build/cancel_job`` to the paired
   * receiver behind *pin_sha256*; the receiver maps *job_id*
   * (the offloader-local id ``submitRemoteBuildJob`` returned)
   * back to its local ``FirmwareJob`` and dispatches the same
   * cancel primitive an operator-driven cancel uses.
   *
   * Fire-and-forget on the wire — the resolved payload's
   * ``sent`` flag reflects whether the cancel frame made it
   * onto the peer-link wire (Noise encrypt + WS send
   * succeeded), not whether the receiver acted on it. A
   * ``sent: false`` resolve means a same-tick channel failure
   * on the offloader side; the cancel never reached the
   * receiver and the caller should treat it as an error.
   * The actual cancel confirmation rides the existing
   * ``OFFLOADER_JOB_STATE_CHANGED`` event stream as a
   * ``status: "cancelled"`` transition, so callers should
   * watch ``buildOffloadJobsContext`` for the terminal flip
   * rather than treating ``sent: true`` as completion.
   *
   * Errors:
   * - INVALID_ARGS: bad pin or empty job_id.
   * - NOT_FOUND: no pairing for the given pin.
   * - PRECONDITION_FAILED: pairing isn't APPROVED, or the
   *   peer-link session isn't currently live.
   */
  async cancelRemoteBuildJob(args: {
    pin_sha256: string;
    job_id: string;
  }): Promise<{ sent: boolean }> {
    return this.sendCommand<{ sent: boolean }>(
      "remote_build/cancel_job",
      args,
    );
  }

  // ─── Remote build: receiver identity ──────────

  /**
   * Read this dashboard's stable identity for the Settings card.
   *
   * Returns '{dashboard_id, pin_sha256, server_version,
   * esphome_version, listener_bound}'. The X25519 private key
   * is intentionally NOT included; only the public-key
   * fingerprint ('pin_sha256', lowercase-hex SHA-256 of the
   * X25519 public key) is safe to ship to a frontend, and the
   * fingerprint is what a sender pins against during the
   * Noise XX handshake. Idempotent (no rotation triggered by
   * reads). Lazy-creates the peer-link keypair on first call
   * if missing.
   */
  async getRemoteBuildIdentity(): Promise<IdentityView> {
    return this.sendCommand<IdentityView>("remote_build/get_identity");
  }

  /**
   * Mint a fresh X25519 peer-link keypair, replacing whatever's on disk.
   *
   * Forces every paired sender to re-pair (the new public key
   * produces a new 'pin_sha256'); 'dashboard_id' is preserved
   * across rotations. If the receiver listener is currently
   * bound, it gets torn down and rebuilt against the new key;
   * the returned 'IdentityView.listener_bound' reflects the
   * rebuild outcome ('false' means the rebuild fail-softed;
   * the operator should check the dashboard logs before
   * assuming the rotation took effect end-to-end).
   *
   * Concurrent calls are rejected with
   * 'ErrorCode.ALREADY_EXISTS'; the caller is expected to
   * confirm before each click. Fires a
   * 'remote_build_identity_rotated' event on the bus carrying
   * '{dashboard_id, pin_sha256}' so other tabs / subscribers
   * refresh without polling.
   */
  async rotateRemoteBuildIdentity(): Promise<IdentityView> {
    return this.sendCommand<IdentityView>("remote_build/rotate_identity");
  }

  /** Get compiled device metadata. */
  async getInfo(configuration: string): Promise<Record<string, unknown> | null> {
    return this.sendCommand("config/get_info", { configuration });
  }

  /** Ping the server. */
  async ping(): Promise<{ pong: boolean }> {
    return this.sendCommand("ping");
  }

  // ─── Editor (live YAML validation) ────────────────────────

  /**
   * Validate YAML for the editor. Backend pipes the content through the
   * upstream `esphome vscode --ace` subprocess and returns the same
   * `{yaml_errors, validation_errors}` shape upstream renders inline.
   */
  async validateYaml(
    configuration: string,
    content: string
  ): Promise<EditorValidateResponse> {
    return this.sendCommand<EditorValidateResponse>(
      "editor/validate_yaml",
      { configuration, content },
      30000
    );
  }
}
