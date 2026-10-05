"""Record what ltchiptool puts on the wire for a whole AmebaZ flash, against a simulated chip.

The frontend's RTL8710B engine is tested against these transcripts: run against
a simulated chip in the same state, it must send the same bytes in the same
order and leave the same flash. Consecutive frames one way are merged, so
how either side splits its reads and writes is no difference.

Usage: record.py <out dir>, the directory of this file to refresh the fixtures.
Run with the interpreter of an ltchiptool 4.14.4 install (PlatformIO's
LibreTiny penv has one). The writes are held at 115200, as the engine does,
instead of the 460800 ltchiptool picks.

Two cases, each a separate transcript:
  ambz-ota2:    the system data already points at this layout's ota2 and the
                switch selects it, so the BINPATCHed second image is written;
  ambz-rewrite: it points elsewhere, so 0x9000 is rewritten and slot 1 written.

The UF2 is built here (ambz.uf2, a few blocks in the bw12 layout, OTA1 with a
BINPATCH relocating it to OTA2) so both sides parse the same file. The
simulated ROM answers what ltchiptool checks for; it says nothing about timing.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path

FAMILY = 0x22E0D6FC
FLASH_SIZE = 0x200000
SYSTEM = 0x9000
OTA1, OTA2 = 0xB000, 0x80000
# uf2tool's writer keeps only the partitions the images use, so the table fits a tag.
PARTITIONS = [("ota1", OTA1, 0x75000), ("ota2", OTA2, 0x75000)]
NAK, ACK, STX, EOT, CAN = 0x15, 0x06, 0x02, 0x04, 0x18
TAG_OTA_FORMAT_2, TAG_OTA_PART_INFO, TAG_BOARD = 0x6C8492, 0xC0EE0C, 0xCA25C8
TAG_BINPATCH, TAG_FAL_PTABLE = 0xB948DE, 0x8288ED
# An image of 10 blocks and a bit, so the last XModem block is short, with a
# pointer into OTA1 every 64 bytes for the BINPATCH to relocate.
IMAGE_LENGTH = 10 * 256 + 40
POINTER_EVERY = 64
CASES = {
    "ambz-ota2": {"ota2_address": 0x08000000 | OTA2, "ota2_switch": 0xFFFFFFFE},
    "ambz-rewrite": {"ota2_address": 0x08100000, "ota2_switch": 0xFFFF0000},
}


def old_byte(i: int) -> int:
    """What the flash holds before the flash: never FF, so an erase shows."""
    return (i * 7 + 3) % 251


def image_bytes() -> bytes:
    data = bytearray((i * 31 + 7) % 253 for i in range(IMAGE_LENGTH))
    for off in range(0, IMAGE_LENGTH - 3, POINTER_EVERY):
        struct.pack_into("<I", data, off, 0x08000000 | (OTA1 + off * 3))
    return bytes(data)


# -- the UF2, as uf2tool's writer lays it out --------------------------------
def tag(kind: int, data: bytes) -> bytes:
    size = 4 + len(data)
    out = bytes([size]) + kind.to_bytes(3, "little") + data
    return out + b"\0" * (-len(out) % 4)


def uf2_block(addr: int, payload: bytes, tags: bytes, block_no: int, num: int, flags: int) -> bytes:
    flags |= 0x2000 | (0x8000 if tags else 0)
    head = struct.pack("<IIIIIIII", 0x0A324655, 0x9E5D5157, flags, addr, len(payload), block_no, num, FAMILY)
    body = (payload + tags).ljust(476, b"\0")
    return head + body + struct.pack("<I", 0x0AB16F30)


def partition_table() -> bytes:
    out = b""
    for name, offset, length in PARTITIONS:
        n = name.encode().ljust(16, b"\0")
        out += struct.pack("<I", 0x45503130) + n + n + struct.pack("<II", offset, length) + b"\0" * 4
    return out


def part_info() -> bytes:
    # device single/ota1/ota2, flasher single/ota1/ota2 -> 0, 1, 2, 0, 1, 2
    return bytes([0x01, 0x20, 0x12]) + b"ota1\0ota2\0"


def build_uf2() -> bytes:
    image = image_bytes()
    chunks = [image[i : i + 256] for i in range(0, len(image), 256)]
    num = len(chunks) + 1
    header = tag(TAG_BOARD, b"bw12") + tag(TAG_OTA_FORMAT_2, b"\x02") + tag(TAG_FAL_PTABLE, partition_table())
    blocks = [uf2_block(0, b"", header, 0, num, 0x1)]
    diff = struct.pack("<i", OTA2 - OTA1)
    for i, chunk in enumerate(chunks):
        offsets = bytes(o for o in range(0, len(chunk) - 3, POINTER_EVERY))
        patch = bytes([0xFE, 4 + len(offsets)]) + diff + offsets
        tags = (tag(TAG_OTA_PART_INFO, part_info()) if i == 0 else b"") + tag(TAG_BINPATCH, patch)
        blocks.append(uf2_block(i * 256, chunk, tags, i + 1, num, 0))
    return b"".join(blocks)


# -- the ROM ----------------------------------------------------------------
class Chip:
    def __init__(self, case: dict) -> None:
        self.flash = bytearray(old_byte(i) for i in range(FLASH_SIZE))
        # The system data: erased but for the OTA fields, and a stray pattern
        # in a gap, which ltchiptool's rewrite erases.
        self.flash[SYSTEM : SYSTEM + 0x1000] = b"\xff" * 0x1000
        struct.pack_into("<II", self.flash, SYSTEM, case["ota2_address"], case["ota2_switch"])
        self.flash[SYSTEM + 0x100 : SYSTEM + 0x110] = bytes(range(0x10))
        self.out = bytearray()
        self.frames: list[dict] = []
        self.idle_naks = 8
        self.prev = 0
        self.pending: list[int] = []  # command bytes still to come
        self.command = 0
        self.reading = None
        self.xmodem = None

    def reply(self, data: bytes) -> None:
        self.frames.append({"dir": "rx", "bytes": bytes(data)})
        self.out += data

    def poll(self) -> None:
        """The loud handshake NAKs on its own while the host listens."""
        if not self.out and self.idle_naks:
            self.idle_naks -= 1
            self.reply(bytes([NAK]))

    def feed(self, data: bytes) -> None:
        self.frames.append({"dir": "tx", "bytes": bytes(data)})
        for byte in data:
            if self.xmodem is not None:
                self.xmodem_byte(byte)
            elif self.pending:
                self.pending.append(byte)
                self.argument()
            else:
                self.start(byte)
            self.prev = byte

    def start(self, byte: int) -> None:
        if byte == CAN:
            self.idle_naks = 8  # disconnect: back to the loud handshake
        elif byte == 0x07 and self.prev == CAN:
            pass  # the middle of the disconnect sequence
        elif byte == 0x07:
            self.reply(bytes([ACK]))
            self.xmodem = bytearray()
        elif byte == 0x21:
            self.reply(bytes([0x00, NAK, NAK, NAK, NAK, NAK]))
        elif byte in (0x05, 0x19):
            self.command = byte
            self.pending = [byte]
        elif byte == ACK:
            if self.reading:
                self.send_chunk()

    def argument(self) -> None:
        if self.command == 0x05 and len(self.pending) == 2:
            self.pending = []
            self.reply(bytes([ACK]))
        elif self.command == 0x19 and len(self.pending) == 6:
            offset = int.from_bytes(bytes(self.pending[1:4]), "little")
            count = int.from_bytes(bytes(self.pending[4:6]), "little") * 4096
            self.pending = []
            self.reading = {"at": offset, "left": count}
            self.send_chunk()

    def send_chunk(self) -> None:
        r = self.reading
        if r["left"] == 0:
            self.reading = None
            return
        self.reply(bytes(self.flash[r["at"] : r["at"] + 1024]))
        r["at"] += 1024
        r["left"] -= 1024

    def xmodem_byte(self, byte: int) -> None:
        x = self.xmodem
        if not x and byte == EOT:
            self.xmodem = None
            self.reply(bytes([ACK]))
            return
        x.append(byte)
        if len(x) < 1032:
            return
        block = bytes(x)
        self.xmodem = bytearray()
        assert block[0] == STX and block[1] + block[2] == 0xFF, "block header"
        payload = block[3:1031]
        assert sum(payload) & 0xFF == block[1031], "checksum"
        address = int.from_bytes(payload[:4], "little")
        data = payload[4:]
        assert address >> 24 == 0x08, "flash only"
        self.flash[address & 0xFFFFFF : (address & 0xFFFFFF) + 1024] = data
        self.reply(bytes([ACK]))


class FakeSerial:
    chip: Chip

    def __init__(self, *args, **kwargs) -> None:
        self.baudrate = kwargs.get("baudrate", args[1] if len(args) > 1 else 115200)
        self.timeout = None

    @property
    def in_waiting(self) -> int:
        self.chip.poll()
        return len(self.chip.out)

    def read(self, size: int = 1) -> bytes:
        data = bytes(self.chip.out[:size])
        del self.chip.out[:size]
        return data

    def read_all(self) -> bytes:
        return self.read(len(self.chip.out))

    def write(self, data: bytes) -> int:
        self.chip.feed(bytes(data))
        return len(data)

    def flush(self) -> None:
        pass

    def open(self) -> None:
        pass

    def close(self) -> None:
        pass


def merged(frames: list[dict]) -> list[dict]:
    """Consecutive frames one way as one: how bytes are split up says nothing."""
    out: list[dict] = []
    for frame in frames:
        if out and out[-1]["dir"] == frame["dir"]:
            out[-1] = {"dir": frame["dir"], "bytes": out[-1]["bytes"] + frame["bytes"]}
        else:
            out.append(dict(frame))
    return out


def summarise(frame: dict) -> dict:
    data: bytes = frame["bytes"]
    out = {"dir": frame["dir"], "length": len(data)}
    if len(data) <= 48:
        out["hex"] = data.hex()
    else:
        out["head"] = data[:16].hex()
        out["sha256"] = hashlib.sha256(data).hexdigest()
    return out


def record(name: str, case: dict, uf2_path: Path) -> dict:
    import io

    import ltchiptool  # noqa: F401 (uf2tool needs it imported first)
    import ltchiptool.util.serialtool as serialtool
    from ltchiptool import Family, SocInterface
    from ltchiptool.util.flash import FlashConnection
    from uf2tool import UploadContext
    from uf2tool.models.uf2 import UF2

    chip = Chip(case)
    FakeSerial.chip = chip
    serialtool.Serial = FakeSerial

    from ltchiptool.soc.amb.system import SystemData
    from ltchiptool.util.intbin import gen2bytes
    from uf2tool import OTAScheme

    uf2 = UF2(io.BytesIO(uf2_path.read_bytes()))
    uf2.read()
    ctx = UploadContext(uf2)
    soc = SocInterface.get(Family.get(short_name="RTL8710B"))
    soc.flash_set_connection(FlashConnection(port="fake", baudrate=115200))
    # AmebaZFlash.flash_write_uf2's steps, in the order the engine needs on
    # an RTL8710BX: the system data read at the link speed (the ROM ignores
    # FLASH_READ at 115200), then the writes held at 115200.
    soc.flash_build_protocol()
    amb = soc.amb
    amb.link()
    system_data = gen2bytes(amb.flash_read(0x9000, 4096, hash_check=False))
    # The engine reads it twice, as an unchecked read could be garbled.
    assert gen2bytes(amb.flash_read(0x9000, 4096, hash_check=False)) == system_data
    system = SystemData.unpack(system_data)
    ota_idx = 1 + (f"{system.ota2_switch:032b}".count("0") % 2)
    part_addr = ctx.get_offset("ota2", 0)
    rewrite = system.ota2_address & 0xFFFFFF != part_addr
    amb.change_baudrate(115200)
    soc.conn.linked = True
    if rewrite:
        system.ota2_address = 0x08000000 | part_addr
        system.ota2_switch = 0xFFFFFFFF
        ota_idx = 1
        packed = system.pack()
        soc.flash_write_raw(0x9000, len(packed), io.BytesIO(packed))
    parts = ctx.collect_data(OTAScheme.FLASHER_DUAL_1 if ota_idx == 1 else OTAScheme.FLASHER_DUAL_2)
    for offset, data in parts.items():
        data.seek(0)
        soc.flash_write_raw(offset, len(data.getvalue()), data)

    return {
        "name": name,
        "reference": "ltchiptool 4.14.4 AmbZTool / AmebaZFlash, flash_write_uf2's steps with the system data read at the link speed, writes held at 115200 and no RAM boot",
        "chip": {k: f"0x{v:08X}" for k, v in case.items()},
        "flash_sha256": hashlib.sha256(bytes(chip.flash)).hexdigest(),
        "frames": [summarise(f) for f in merged(chip.frames)],
    }


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    uf2_path = out / "ambz.uf2"
    uf2_path.write_bytes(build_uf2())
    for name, case in CASES.items():
        result = record(name, case, uf2_path)
        (out / f"{name}.json").write_text(json.dumps(result, indent=1) + "\n")
        tx = sum(1 for f in result["frames"] if f["dir"] == "tx")
        print(f"{name}: frames={len(result['frames'])} tx={tx}")


main()
