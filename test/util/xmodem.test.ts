import { describe, expect, it } from "vitest";

import { fakeReceiver } from "./_fake-modem-receiver.js";

import {
  buildBlock,
  crc16Xmodem,
  XMODEM_BLOCK_SIZE,
  XmodemError,
  xmodemSend,
} from "../../src/util/xmodem.js";

const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;

const bytes = (n: number, fill = 0x5a) => new Uint8Array(n).fill(fill);

describe("crc16Xmodem", () => {
  it("matches the CRC-16/XMODEM check value", () => {
    expect(crc16Xmodem(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });
});

describe("buildBlock", () => {
  it("sends a 1k block that carries more as STX", () => {
    const block = buildBlock(1, bytes(1028), false, 1028, 0xff);
    expect(block.length).toBe(3 + 1028 + 1);
    expect([block[0], block[1], block[2]]).toEqual([STX, 1, 0xfe]);
    expect(block[1031]).toBe((1028 * 0x5a) & 0xff);
  });

  it("keeps SOH for 128-byte blocks", () => {
    expect(buildBlock(1, bytes(128), false, 128)[0]).toBe(0x01);
  });
});

describe("xmodemSend", () => {
  it("sends checksum-mode 1k blocks after a NAK, padded, then EOT", async () => {
    const rx = fakeReceiver([NAK, ACK, ACK, ACK]);
    const sent: number[] = [];
    await xmodemSend(rx.io, bytes(1030), { onBlock: (s) => sent.push(s) });
    expect(rx.writes).toHaveLength(3);
    const [first, second, eot] = rx.writes;
    expect(first.length).toBe(3 + XMODEM_BLOCK_SIZE + 1);
    expect([first[0], first[1], first[2]]).toEqual([STX, 1, 0xfe]);
    expect(first[first.length - 1]).toBe((1024 * 0x5a) & 0xff);
    expect([second[0], second[1], second[2]]).toEqual([STX, 2, 0xfd]);
    // The tail block carries 6 real bytes and 0x1a padding.
    expect(second[3 + 5]).toBe(0x5a);
    expect(second[3 + 6]).toBe(0x1a);
    expect([...eot]).toEqual([EOT]);
    expect(sent).toEqual([1024, 1030]);
  });

  it("uses CRC-16 when the receiver asks with 'C'", async () => {
    const rx = fakeReceiver([0x43, ACK, ACK]);
    const data = bytes(10, 0x33);
    await xmodemSend(rx.io, data);
    const block = rx.writes[0];
    expect(block.length).toBe(3 + XMODEM_BLOCK_SIZE + 2);
    const crc = crc16Xmodem(block.subarray(3, 3 + XMODEM_BLOCK_SIZE));
    expect([block[block.length - 2], block[block.length - 1]]).toEqual([
      crc >> 8,
      crc & 0xff,
    ]);
  });

  it("resends a block that was NAKed and gives up past the retry budget", async () => {
    const rx = fakeReceiver([NAK, NAK, ACK, ACK]);
    await xmodemSend(rx.io, bytes(4));
    expect(rx.writes).toHaveLength(3);
    expect(rx.writes[0]).toEqual(rx.writes[1]);

    const stubborn = fakeReceiver([NAK, NAK, NAK, NAK]);
    await expect(xmodemSend(stubborn.io, bytes(4), { retries: 2 })).rejects.toThrow(
      /not acknowledged after 2 retries/
    );
  });

  it("skips a stray byte before the reply instead of sending the block again", async () => {
    // Line noise or a receiver's repeated 'C' between a block and its ACK,
    // as ltchiptool's sender skips it.
    const rx = fakeReceiver([NAK, 0x43, 0x00, ACK, ACK]);
    await xmodemSend(rx.io, bytes(4));
    expect(rx.writes).toHaveLength(2);
    expect(rx.writes[1]).toEqual(new Uint8Array([EOT]));
  });

  it("stops on a cancel at the end of the file", async () => {
    const rx = fakeReceiver([NAK, ACK, CAN]);
    await expect(xmodemSend(rx.io, bytes(4))).rejects.toThrow(
      "Receiver cancelled at the end of the file"
    );
  });

  it("stops on a cancel from the receiver", async () => {
    const rx = fakeReceiver([NAK, CAN]);
    await expect(xmodemSend(rx.io, bytes(4))).rejects.toBeInstanceOf(XmodemError);
  });

  it("fails when the receiver never starts the transfer", async () => {
    const rx = fakeReceiver([]);
    await expect(xmodemSend(rx.io, bytes(4), { retries: 1 })).rejects.toThrow(
      /never asked/
    );
    expect(rx.writes).toHaveLength(0);
  });

  it("wraps the sequence number after 255 blocks", async () => {
    const replies = [NAK, ...new Array(257).fill(ACK)];
    const rx = fakeReceiver(replies);
    await xmodemSend(rx.io, bytes(256 * XMODEM_BLOCK_SIZE, 0));
    expect(rx.writes[255][1]).toBe(0);
    expect(rx.writes[255][2]).toBe(0xff);
  });
});
