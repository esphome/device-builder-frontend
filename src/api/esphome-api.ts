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
  CommandMessage,
  ComponentCatalogEntry,
  DevicesResponse,
  ErrorMessage,
  EventMessage,
  EventSubscriptionCallback,
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
    } catch {
      console.error("Invalid JSON from WebSocket");
      return;
    }

    // ServerInfoMessage — sent on connect, has server_version
    if ("server_version" in data) {
      this._serverInfo = data as unknown as ServerInfoMessage;
      this._connected = true;
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
      // Auto-reconnect after delay
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connect().catch(() => {
          // Will retry on next close
        });
      }, 5000);
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
    args?: Record<string, unknown>
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
      this._pendingRequests.set(messageId, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });
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
    config_type?: string;
    platform?: string;
    board?: string;
    ssid?: string;
    psk?: string;
    password?: string;
    file_content?: string;
    board_id?: string;
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

  /** Delete a device and all associated files. */
  async deleteDevice(configuration: string): Promise<void> {
    await this.sendCommand("devices/delete", { configuration });
  }

  /** Get device YAML config. */
  async getConfig(configuration: string): Promise<string> {
    return this.sendCommand<string>("devices/get_config", { configuration });
  }

  /** Save device YAML config. */
  async updateConfig(configuration: string, content: string): Promise<void> {
    await this.sendCommand("devices/update_config", { configuration, content });
  }

  /** Add a component to a device config. */
  async addComponent(
    configuration: string,
    args: {
      component_id: string;
      fields?: Record<string, unknown>;
      sub_entities?: Record<string, Record<string, unknown>>;
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

  // ─── Streaming Commands ───────────────────────────────────

  /** Compile a device configuration. */
  compile(configuration: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand("devices/compile", { configuration }, callbacks);
  }

  /** Upload firmware to a device. */
  upload(configuration: string, port: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand(
      "devices/upload",
      { configuration, port },
      callbacks
    );
  }

  /** Stream logs from a device. */
  logs(configuration: string, port: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand(
      "devices/logs",
      { configuration, port },
      callbacks
    );
  }

  /** Validate a device configuration. */
  validate(configuration: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand("devices/validate", { configuration }, callbacks);
  }

  /** Clean build files for a device. */
  clean(configuration: string, callbacks: StreamCallbacks): string {
    return this.sendStreamCommand("devices/clean", { configuration }, callbacks);
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

  /** Get a single component by ID. */
  async getComponent(componentId: string): Promise<ComponentCatalogEntry | null> {
    return this.sendCommand("components/get_component", {
      component_id: componentId,
    });
  }

  /** Get components with optional filtering, search, and pagination. */
  async getComponents(args?: {
    query?: string;
    category?: string;
    offset?: number;
    limit?: number;
  }): Promise<PagedComponentsResponse> {
    return this.sendCommand<PagedComponentsResponse>(
      "components/get_components",
      args
    );
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

  /** Update user preferences. */
  async updatePreferences(prefs: UserPreferences): Promise<UserPreferences> {
    return this.sendCommand<UserPreferences>(
      "config/set_preferences",
      prefs as unknown as Record<string, unknown>
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
}

