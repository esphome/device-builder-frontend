import { describe, expect, it } from "vitest";

import { fakeReceiver } from "./_fake-modem-receiver.js";

import { crc16Xmodem, XmodemError } from "../../src/util/xmodem.js";
import { YMODEM_BLOCK_SIZE, ymodemSend } from "../../src/util/ymodem.js";

const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const C = 0x43;

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 3) & 0xff);
const payload = (block: Uint8Array) => block.subarray(3, 3 + YMODEM_BLOCK_SIZE);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("ymodemSend", () => {
  it("sends the header, 128-byte CRC blocks, EOT twice when NAKed, then the empty header", async () => {
    // As the LN882H RAM code answers: C, ACK+C for the header, ACK per
    // block, NAK for the first EOT and ACK+C for the second.
    const rx = fakeReceiver([C, ACK, C, ACK, ACK, NAK, ACK, C]);
    const sent: number[] = [];
    await ymodemSend(rx.io, "firmware.bin", bytes(200), {
      onBlock: (n) => sent.push(n),
    });
    const [header, first, second, eot1, eot2, end] = rx.writes;
    expect(rx.writes).toHaveLength(6);

    expect(header.length).toBe(3 + YMODEM_BLOCK_SIZE + 2);
    expect([header[0], header[1], header[2]]).toEqual([SOH, 0, 0xff]);
    // Name, NUL, then length, an unknown mtime and no serial number; zero padded.
    expect(text(payload(header).subarray(0, 20))).toBe("firmware.bin\u0000200 0 0");
    expect(
      payload(header)
        .subarray(20)
        .every((b) => b === 0)
    ).toBe(true);
    const crc = crc16Xmodem(payload(header));
    expect([header[131], header[132]]).toEqual([crc >> 8, crc & 0xff]);

    expect([first[0], first[1], first[2]]).toEqual([SOH, 1, 0xfe]);
    expect(payload(first)).toEqual(bytes(200).subarray(0, 128));
    expect([second[0], second[1], second[2]]).toEqual([SOH, 2, 0xfd]);
    // 72 real bytes, then 0x1a padding.
    expect(payload(second).subarray(0, 72)).toEqual(bytes(200).subarray(128));
    expect(
      payload(second)
        .subarray(72)
        .every((b) => b === 0x1a)
    ).toBe(true);

    expect([...eot1, ...eot2]).toEqual([EOT, EOT]);
    expect([end[0], end[1], end[2]]).toEqual([SOH, 0, 0xff]);
    expect(payload(end).every((b) => b === 0)).toBe(true);
    expect(sent).toEqual([128, 200]);
  });

  it("sends the plain checksum when the receiver opens with NAK", async () => {
    const rx = fakeReceiver([NAK, ACK, NAK, ACK, ACK]);
    await ymodemSend(rx.io, "a", bytes(10));
    const [header, block] = rx.writes;
    expect(header.length).toBe(3 + YMODEM_BLOCK_SIZE + 1);
    expect(block[block.length - 1]).toBe(
      payload(block).reduce((sum, b) => (sum + b) & 0xff, 0)
    );
  });

  it("skips the 'C' a waiting receiver repeats while it waits for a reply", async () => {
    const rx = fakeReceiver([C, C, C, ACK, C, C, ACK, ACK]);
    await ymodemSend(rx.io, "a", bytes(10));
    // Header, one block, EOT, the empty header: nothing sent twice.
    expect(rx.writes).toHaveLength(4);
  });

  it("sends a block again when the receiver NAKs it", async () => {
    const rx = fakeReceiver([C, ACK, C, NAK, ACK, ACK]);
    await ymodemSend(rx.io, "a", bytes(10));
    const [, first, again] = rx.writes;
    expect(again).toEqual(first);
  });

  it("gives up on a block after its retries", async () => {
    const rx = fakeReceiver([C, ACK, C, NAK, NAK, NAK]);
    await expect(ymodemSend(rx.io, "a", bytes(10), { retries: 2 })).rejects.toThrow(
      "block 1 was not acknowledged after 2 retries"
    );
  });

  it("stops when the receiver cancels", async () => {
    const rx = fakeReceiver([C, CAN]);
    await expect(ymodemSend(rx.io, "a", bytes(10))).rejects.toBeInstanceOf(XmodemError);
  });

  it("stops when the receiver cancels at the end of the file", async () => {
    const rx = fakeReceiver([C, ACK, C, ACK, CAN]);
    await expect(ymodemSend(rx.io, "a", bytes(10))).rejects.toThrow(
      "Receiver cancelled at the end of the file"
    );
  });

  it("gives up when the end of the file is never acknowledged", async () => {
    const rx = fakeReceiver([C, ACK, C, ACK]);
    await expect(ymodemSend(rx.io, "a", bytes(10), { retries: 1 })).rejects.toThrow(
      "the end of the file was not acknowledged after 1 retry"
    );
  });

  it("fails when the receiver never asks for the file", async () => {
    const rx = fakeReceiver([]);
    await expect(ymodemSend(rx.io, "a", bytes(10), { retries: 1 })).rejects.toThrow(
      "Receiver never asked for the first block"
    );
  });
});
