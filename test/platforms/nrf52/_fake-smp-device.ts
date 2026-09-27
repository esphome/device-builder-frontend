import {
  buildSmpFrame,
  IMG_MGMT_STATE,
  IMG_MGMT_UPLOAD,
  MGMT_GROUP_IMAGE,
  MGMT_GROUP_OS,
  OS_MGMT_MCUMGR_PARAMS,
  OS_MGMT_RESET,
  parseSmpFrame,
  SmpNoReplyError,
  type SmpTransport,
} from "../../../src/platforms/nrf52/smp-protocol.js";

export const RUNNING = new Uint8Array(32).fill(0x11);

export interface Slot {
  slot: number;
  hash: Uint8Array;
  active?: boolean;
  confirmed?: boolean;
}

/** An mcumgr device: answers the image and OS commands the upload sends. */
export class FakeSmpDevice implements SmpTransport {
  slots: Slot[] = [{ slot: 0, hash: RUNNING, active: true, confirmed: true }];
  received = new Uint8Array(0);
  readonly requests: Array<{ group: number; id: number; payload: object }> = [];
  /** Replaces the reply to an upload chunk; return undefined to answer normally. */
  onUpload?: (payload: Record<string, unknown>) => object | undefined;
  /** The hash the device gives an uploaded image. */
  uploadedHash = new Uint8Array(32).fill(0xab);
  resetDropsLink = false;
  resetWriteFails = false;
  resetReply: object = {};
  /** What the device answers a parameters query with; an error when unset. */
  params?: { buf_size: number; buf_count: number };

  async exchange(frame: Uint8Array): Promise<Uint8Array> {
    const req = parseSmpFrame(frame);
    this.requests.push({ group: req.group, id: req.id, payload: req.payload });
    const reply = (payload: object) =>
      buildSmpFrame(req.op + 1, req.group, req.id, req.seq, payload);

    if (req.group === MGMT_GROUP_OS && req.id === OS_MGMT_MCUMGR_PARAMS) {
      return reply(this.params ?? { rc: 8 });
    }
    if (req.group === MGMT_GROUP_OS && req.id === OS_MGMT_RESET) {
      if (this.resetDropsLink) throw new SmpNoReplyError("link dropped");
      if (this.resetWriteFails) throw new Error("write failed");
      return reply(this.resetReply);
    }
    if (req.group === MGMT_GROUP_IMAGE && req.id === IMG_MGMT_STATE) {
      const hash = req.payload.hash;
      if (hash instanceof Uint8Array && req.payload.confirm === true) {
        for (const s of this.slots) if (s.active) s.confirmed = true;
      }
      return reply({ images: this.slots });
    }
    if (req.group === MGMT_GROUP_IMAGE && req.id === IMG_MGMT_UPLOAD) {
      const override = this.onUpload?.(req.payload);
      if (override) return reply(override);
      const data = req.payload.data as Uint8Array;
      const merged = new Uint8Array(this.received.length + data.length);
      merged.set(this.received);
      merged.set(data, this.received.length);
      this.received = merged;
      if (req.payload.off === 0) this.total = req.payload.len as number;
      if (this.received.length === this.total) {
        this.slots = [...this.slots, { slot: 1, hash: this.uploadedHash }];
      }
      return reply({ rc: 0, off: this.received.length });
    }
    throw new Error(`unexpected request ${req.group}/${req.id}`);
  }

  private total = -1;

  ids(): string[] {
    return this.requests.map((r) => `${r.group}/${r.id}`);
  }
}
