/** A minimal MCUboot image: header, body, optional protected TLVs, SHA256 TLV. */
export function makeMcubootImage({
  bodySize = 300,
  version = [1, 2, 3] as [number, number, number],
  imageHash = new Uint8Array(32).fill(0xab),
  protectedTlvSize = 0,
  magic = 0x96f3b83d,
  loadAddress = 0,
}: {
  bodySize?: number;
  version?: [number, number, number];
  imageHash?: Uint8Array | null;
  protectedTlvSize?: number;
  magic?: number;
  loadAddress?: number;
} = {}): Uint8Array {
  const headerSize = 32;
  const tlvSize = imageHash ? 4 + 4 + 32 : 0;
  const bytes = new Uint8Array(headerSize + bodySize + protectedTlvSize + tlvSize);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, loadAddress, true);
  view.setUint16(8, headerSize, true);
  view.setUint16(10, protectedTlvSize, true);
  view.setUint32(12, bodySize, true);
  view.setUint8(20, version[0]);
  view.setUint8(21, version[1]);
  view.setUint16(22, version[2], true);
  for (let i = 0; i < bodySize; i++) bytes[headerSize + i] = i & 0xff;
  if (imageHash) {
    const tlv = headerSize + bodySize + protectedTlvSize;
    view.setUint16(tlv, 0x6907, true);
    view.setUint16(tlv + 2, tlvSize, true);
    view.setUint8(tlv + 4, 0x10);
    view.setUint16(tlv + 6, 32, true);
    bytes.set(imageHash, tlv + 8);
  }
  return bytes;
}
