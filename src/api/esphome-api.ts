/**
 * ESPHome Device Builder API client.
 *
 * Single multiplexed WebSocket connection to /ws.
 * All commands use the {command, message_id, args} → {result} protocol.
 * Streaming commands (compile, upload, logs, validate, clean) receive
 * EventMessages with "output" and "result" events.
 */
import type {
  AddComponentResponse,
  BoardCatalogEntry,
  BulkDeleteResult,
  CommandMessage,
  ComponentCatalogEntry,
  DevicesResponse,
  EditorValidateResponse,
  ErrorMessage,
  EventMessage,
  EventSubscriptionCallback,
  FirmwareBinary,
  FirmwareDownload,
  FirmwareJob,
  PagedBoardsResponse,
  PagedComponentsResponse,
  ResultMessage,
  SerialPort,
  ServerInfoMessage,
  StreamCallbacks,
  UpdateDeviceResponse,
  UserPreferences,
  WizardResponse,
} from "./types.js";

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
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = 1000;
  private _intentionalDisconnect = false;
  private _connectPromise: {
    resolve: (info: ServerInfoMessage) => void;
    reject: (error: Error) => void;
  } | null = null;

  // Callbacks for connection state changes
  onConnected?: (info: ServerInfoMessage) => void;
  onDisconnected?: () => void;

  get connected(): boolean {
    return this._connected;
  }

  get serverInfo(): ServerInfoMessage | null {
    return this._serverInfo;
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

    return new Promise((resolve, reject) => {
      this._connectPromise = { resolve, reject };
      this._intentionalDisconnect = false;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

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
      console.debug("[RECEIVED]", data);
    } catch {
      console.error("Invalid JSON from WebSocket");
      return;
    }

    // ServerInfoMessage — sent on connect, has server_version
    if ("server_version" in data) {
      this._serverInfo = data as unknown as ServerInfoMessage;
      this._connected = true;
      this._reconnectDelay = 1000;
      if (this._connectPromise) {
        this._connectPromise.resolve(this._serverInfo);
        this._connectPromise = null;
      }
      this.onConnected?.(this._serverInfo);
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
        pending.reject(new Error(`${err.error_code}: ${err.details || ""}`));
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

  private _onClose(): void {
    const wasConnected = this._connected;
    this._connected = false;
    this._ws = null;

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
      console.debug("[SENDING]", msg);
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

  // ─── Device Commands ──────────────────────────────────────

  /** List all configured and importable devices. */
  async listDevices(): Promise<DevicesResponse> {
    return this.sendCommand<DevicesResponse>("devices/list");
  }

  /** Trigger device state polling. */
  async getDeviceStates(): Promise<Record<string, never>> {
    return this.sendCommand("devices/get_states");
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
    newName: string,
  ): Promise<{ configuration: string; job: FirmwareJob | null }> {
    return this.sendCommand<{ configuration: string; job: FirmwareJob | null }>(
      "devices/rename",
      { configuration, new_name: newName },
      60000,
    );
  }

  /** Delete a device and all associated files. */
  async deleteDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/delete", { configuration });
  }

  /** Delete multiple devices at once. Returns per-device results. */
  async deleteBulkDevices(configurations: string[]): Promise<BulkDeleteResult[]> {
    return this.sendCommand<BulkDeleteResult[]>("devices/delete_bulk", {
      configurations,
    });
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
    const result = await this.sendCommand<{ key: unknown }>(
      "devices/get_api_key",
      { configuration },
    );
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
    options: { showSecrets?: boolean } = {},
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
    options: { noStates?: boolean } = {},
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
  firmwareFollowJobs(
    callback: EventSubscriptionCallback,
    snapshot = true
  ): string {
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

  /** Queue a compile+upload job (defaults to OTA). */
  async firmwareInstall(configuration: string, port = "OTA"): Promise<FirmwareJob> {
    return this.sendCommand<FirmwareJob>("firmware/install", { configuration, port });
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
    const raw = await this.sendCommand<unknown>(
      "components/get_integration_docs",
    );
    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
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
