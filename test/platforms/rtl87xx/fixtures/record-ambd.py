"""Record what ltchiptool puts on the wire for a whole AmebaD flash, against a simulated chip.

The frontend's RTL8720D engine is tested against this transcript: run against
a simulated chip in the same state, it must send the same bytes in the same
order and leave the same flash. Consecutive frames one way are merged, so
how either side splits its reads and writes is no difference.

Usage: record-ambd.py <out dir>, the directory of this file to refresh the
fixtures. Run with the interpreter of an install of ltchiptool PR 98
(libretiny-eu/ltchiptool#98, the AmebaD SoC), at 115200 throughout as the
engine runs: the loader, the first OTA slot's erase, write and checksum,
then the second slot's first sector erased so the bootloader starts the
first (what the engine adds over ltchiptool's own write).

The UF2 is built here (ambd.uf2, a few blocks in the bw16 layout, one image
for both slots as the AmebaD builder packs it) so both sides parse the same
file. The flash loader is a stand-in pattern: the transcript is about the
protocol, and the real file is not ours to ship. The simulated chip answers
what ltchiptool checks for and says nothing about timing; it NAKs only
where a reply needs one (the XModem start), never while idle.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path

FAMILY = 0x3379CFE2
FLASH_SIZE = 0x400000
SECTOR = 0x1000
OTA1, OTA2 = 0x6000, 0x206000
PARTITIONS = [("ota1", OTA1, 0x1FA000), ("ota2", OTA2, 0x1E2000)]
LOADER_ADDRESS = 0x82000
RAM_SIZE = 0x8000
FLASH_ID = bytes([0x20, 0x40, 0x16])
BANNER = b"UARTIMG_Download 2\n\r"
SIGNATURE = b"81958711"
NAK, ACK, STX, EOT, CAN = 0x15, 0x06, 0x02, 0x04, 0x18
TAG_OTA_FORMAT_2, TAG_OTA_PART_INFO, TAG_BOARD, TAG_FAL_PTABLE = 0x6C8492, 0xC0EE0C, 0xCA25C8, 0x8288ED
# Ten blocks and a bit, so the last XModem block is short.
BLOCKS = 11


def old_byte(i: int) -> int:
    """What the flash holds before the flash: never FF, so an erase shows."""
    return (i * 7 + 3) % 251


def loader_bytes() -> bytes:
    """The stand-in loader, the size of the real one."""
    return bytes((i * 3 + 1) % 255 for i in range(4688))


def image_bytes() -> bytes:
    out = bytearray()
    for i in range(BLOCKS - 1):
        out += bytes([(i * 17 + 1) % 251]) * 256
    out += bytes((j * 31 + 7) % 253 for j in range(40))
    return bytes(out)


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
    header = tag(TAG_BOARD, b"bw16") + tag(TAG_OTA_FORMAT_2, b"\x02") + tag(TAG_FAL_PTABLE, partition_table())
    blocks = [uf2_block(0, b"", header, 0, num, 0x1)]
    for i, chunk in enumerate(chunks):
        tags = tag(TAG_OTA_PART_INFO, part_info()) if i == 0 else b""
        blocks.append(uf2_block(i * 256, chunk, tags, i + 1, num, 0))
    return b"".join(blocks)


# -- the ROM and the loader --------------------------------------------------
class Chip:
    def __init__(self) -> None:
        self.flash = bytearray(old_byte(i) for i in range(FLASH_SIZE))
        # A valid image in the second slot: what the bootloader would run.
        self.flash[OTA2 : OTA2 + len(SIGNATURE)] = SIGNATURE
        self.ram = bytearray((i * 13 + 5) % 253 for i in range(RAM_SIZE))
        self.erased: set[int] = set()
        self.loader_up = False
        self.out = bytearray()
        self.frames: list[dict] = []
        self.pending: list[int] = []
        self.xmodem: bytearray | None = None

    def reply(self, data: bytes) -> None:
        self.frames.append({"dir": "rx", "bytes": bytes(data)})
        self.out += data

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

    def start(self, byte: int) -> None:
        if byte == CAN:
            return
        if byte == 0x07:
            self.reply(bytes([ACK]))
            self.xmodem = bytearray()
            self.reply(bytes([NAK]))  # asks for checksum blocks
        elif byte in (0x31, 0x21, 0x17, 0x27, 0x05):
            self.pending = [byte]

    def argument(self) -> None:
        cmd = self.pending[0]
        if cmd == 0x31 and len(self.pending) == 5:
            address = int.from_bytes(bytes(self.pending[1:5]), "little")
            self.pending = []
            at = address - LOADER_ADDRESS
            word = bytes(self.ram[at : at + 4]) if 0 <= at <= RAM_SIZE - 4 else b"\0\0\0\0"
            self.reply(bytes([0x31]) + word + bytes([NAK]))
        elif cmd == 0x21 and len(self.pending) == 3:
            self.pending = []
            if self.loader_up:
                self.reply(bytes([0x21]) + FLASH_ID)
        elif cmd == 0x17 and len(self.pending) == 6:
            offset = int.from_bytes(bytes(self.pending[1:4]), "little")
            count = int.from_bytes(bytes(self.pending[4:6]), "little")
            self.pending = []
            if not self.loader_up:
                return
            for i in range(count):
                sector = offset + i * SECTOR
                self.flash[sector : sector + SECTOR] = b"\xff" * SECTOR
                self.erased.add(sector)
            self.reply(bytes([ACK]))
        elif cmd == 0x27 and len(self.pending) == 7:
            offset = int.from_bytes(bytes(self.pending[1:4]), "little")
            length = int.from_bytes(bytes(self.pending[4:7]), "little")
            self.pending = []
            if not self.loader_up:
                return
            self.reply(bytes([0x27]) + struct.pack("<I", self.checksum(offset, length)))
        elif cmd == 0x05 and len(self.pending) == 2:
            self.pending = []
            self.reply(bytes([ACK]))

    def checksum(self, offset: int, length: int) -> int:
        data = bytes(self.flash[offset : offset + length])
        words = length - length % 4
        total = sum(struct.unpack_from("<%dI" % (words // 4), data)) if words else 0
        for i in range(words, length):
            total += data[i] << ((i - words) * 8)
        return total & 0xFFFFFFFF

    def xmodem_byte(self, byte: int) -> None:
        x = self.xmodem
        if not x and byte == EOT:
            self.xmodem = None
            self.reply(bytes([ACK]))
            if not self.loader_up and bytes(self.ram[:4]) == loader_bytes()[:4]:
                self.loader_up = True
                self.reply(BANNER)
            return
        if not x and byte == CAN:
            self.xmodem = None
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
        if address >> 24 == 0x08:
            assert self.loader_up, "flash write without the loader"
            offset = address & 0xFFFFFF
            for i in range(0, len(data), SECTOR):
                sector = (offset + i) - (offset + i) % SECTOR
                assert sector in self.erased, f"write to unerased sector 0x{sector:x}"
            self.flash[offset : offset + len(data)] = data
        else:
            at = address - LOADER_ADDRESS
            assert 0 <= at and at + len(data) <= RAM_SIZE, "write outside RAM and flash"
            self.ram[at : at + len(data)] = data
        self.reply(bytes([ACK]))


class FakeSerial:
    chip: Chip

    def __init__(self, *args, **kwargs) -> None:
        self.baudrate = kwargs.get("baudrate", args[1] if len(args) > 1 else 115200)
        self.timeout = None

    @property
    def in_waiting(self) -> int:
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


def record(uf2_path: Path) -> dict:
    import io

    import ltchiptool  # noqa: F401 (uf2tool needs it imported first)
    import ltchiptool.util.serialtool as serialtool
    from ltchiptool.soc.ambd.util.ambdtool import AmbDTool
    from uf2tool import UploadContext
    from uf2tool.models.enums import OTAScheme
    from uf2tool.models.uf2 import UF2

    chip = Chip()
    FakeSerial.chip = chip
    serialtool.Serial = FakeSerial

    uf2 = UF2(io.BytesIO(uf2_path.read_bytes()))
    uf2.read()
    ctx = UploadContext(uf2)
    ota2 = ctx.get_offset("ota2", 0)
    parts = ctx.collect_data(OTAScheme.FLASHER_DUAL_1)

    # AmebaDFlash.flash_connect's steps at the ROM speed (no baud change),
    # then flash_write_raw per part, then the clear of the second slot.
    amb = AmbDTool(port="fake", baudrate=115200)
    amb.loader_ensure(loader_bytes())
    amb.flash_read_id()
    for offset, data in parts.items():
        amb.flash_write(offset, data.getvalue(), verify=True)
    amb.flash_erase(ota2, SECTOR)
    amb.close()

    return {
        "name": "ambd-ota1",
        "reference": "ltchiptool PR 98 AmbDTool: loader_ensure, flash_read_id, flash_write per part at 115200, then flash_erase of the second slot's first sector",
        "flash_sha256": hashlib.sha256(bytes(chip.flash)).hexdigest(),
        "frames": [summarise(f) for f in merged(chip.frames)],
    }


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    uf2_path = out / "ambd.uf2"
    uf2_path.write_bytes(build_uf2())
    result = record(uf2_path)
    (out / "ambd-ota1.json").write_text(json.dumps(result, indent=1) + "\n")
    tx = sum(1 for f in result["frames"] if f["dir"] == "tx")
    print(f"ambd-ota1: frames={len(result['frames'])} tx={tx}")


main()
