"""Record what ltchiptool puts on the wire for a whole LN882H flash, against a simulated chip.

The frontend's LN882H engine is tested against this transcript: run against a
simulated chip in the same state, it must send the same bytes in the same
order, apart from the extra links ltchiptool makes and the flash_info the
engine asks for.

Usage: record.py <out dir>, the directory of this file to refresh the fixture.
Run with the interpreter of an ltchiptool 4.14.4 install (PlatformIO's
LibreTiny penv has one). The write is held at 115200, as the engine does,
instead of the 1 Mbaud ltchiptool switches to.

The simulated chip is a model of the SDK's ramcode_dl sources (cmd_mode.c,
ymodem.c) and of what ltchiptool expects to read back; the BootROM's own
answers are what ltchiptool checks for. It says nothing about timing. The RAM
code here is a stand-in of the right shape, not Lightning's file.
"""

import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

FLASH_SIZE = 0x200000
SECTOR = 0x1000
ROM_VERSION = "Mar 14 2021/12:34:56"
FLASH_ID = 0xEB6015
SOH, EOT, ACK, NAK = 0x01, 0x04, 0x06, 0x15
C = 0x43


def old_byte(i: int) -> int:
    """What the flash holds before the flash: never FF, so an erase shows."""
    return (i * 7 + 3) % 251


def new_byte(i: int) -> int:
    """The image's bytes, by offset in its run."""
    return (i * 31 + 7) % 253


def ramcode_byte(i: int) -> int:
    return (i * 13 + 5) % 256


RAMCODE = bytes(ramcode_byte(i) for i in range(1000))
# A run from 0 the way a build's bootloader, partition table and app run on,
# and a second one, short of a block, to cover more than one transfer.
RUNS = [
    (0x0, bytes(new_byte(i) for i in range(3 * 128 + 50))),
    (0x7000, bytes(new_byte(i + 7) for i in range(300))),
]


def crc16(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


class Chip:
    def __init__(self) -> None:
        self.flash = bytearray(old_byte(i) for i in range(FLASH_SIZE))
        self.mode = "rom"  # rom | ramcode
        self.ymodem: dict | None = None
        self.line = ""
        self.start_addr = 0
        self.ram = b""
        self.rebooted = False
        self.out = bytearray()
        self.frames: list[dict] = []

    def reply(self, data: bytes) -> None:
        self.frames.append({"dir": "rx", "bytes": bytes(data)})
        self.out += data

    def feed(self, data: bytes) -> None:
        self.frames.append({"dir": "tx", "bytes": bytes(data)})
        if self.ymodem is not None:
            self.ymodem_feed(data)
            return
        if self.mode == "ramcode":
            echo = bytes(b for b in data if 0x20 <= b < 0x7F)
            if echo:
                self.reply(echo)
        for byte in data:
            ch = chr(byte)
            if ch in "\r\n":
                line, self.line = self.line, ""
                if line:
                    self.command(line)
            else:
                self.line += ch

    def command(self, line: str) -> None:
        words = line.split(" ")
        if self.mode == "rom":
            if line == "version":
                self.reply(f"\r\n{ROM_VERSION}\r\n".encode())
            elif words[0] == "download" and words[1] == "[rambin]":
                self.ymodem_start("ram")
            return
        if line == "version":
            self.reply(b"\r\nRAMCODE\r\n")
        elif line == "flash_info":
            self.reply(f"\r\nid:0x{FLASH_ID:X},flash size:2M Byte\r\n".encode())
        elif words[0] == "startaddr" and len(words) > 1:
            self.start_addr = int(words[1], 16)
            self.reply(b"\r\npppp\r\n")
        elif line == "upgrade":
            self.ymodem_start("flash")
        elif line == "reboot":
            self.reply(b"\r\npppp\r\n")
            self.rebooted = True

    # -- YMODEM receiver, as ramcode_dl/main/ymodem.c --------------------------
    def ymodem_start(self, target: str) -> None:
        self.ymodem = {"target": target, "buf": bytearray(), "packets": 0, "eot": 0,
                       "length": 0, "data": bytearray()}
        self.reply(bytes([C]))

    def ymodem_feed(self, data: bytes) -> None:
        y = self.ymodem
        y["buf"] += data
        while y["buf"]:
            if y["buf"][0] == EOT:
                del y["buf"][0]
                y["eot"] += 1
                self.reply(bytes([NAK]) if y["eot"] == 1 else bytes([ACK, C]))
                continue
            if y["buf"][0] != SOH or len(y["buf"]) < 133:
                return
            block = bytes(y["buf"][:133])
            del y["buf"][:133]
            seq, payload = block[1], block[3:131]
            assert seq + block[2] == 0xFF, "sequence complement"
            assert crc16(payload) == (block[131] << 8 | block[132]), "CRC"
            if y["packets"] == 0:
                name, _, rest = payload.partition(b"\0")
                y["length"] = int(rest.split(b" ")[0])
                if y["target"] == "flash":
                    length = -(-y["length"] // SECTOR) * SECTOR
                    self.flash[self.start_addr : self.start_addr + length] = b"\xff" * length
                self.reply(bytes([ACK, C]))
            elif y["eot"] > 1 and seq == 0:
                self.reply(bytes([ACK]))
                self.ymodem_done()
                return
            else:
                assert seq == y["packets"] & 0xFF, "sequence"
                y["data"] += payload
                self.reply(bytes([ACK]))
            y["packets"] += 1

    def ymodem_done(self) -> None:
        y, self.ymodem = self.ymodem, None
        data = bytes(y["data"][: y["length"]])
        if y["target"] == "ram":
            self.ram = data
            self.mode = "ramcode"
        else:
            self.flash[self.start_addr : self.start_addr + len(data)] = data


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


def summarise(frame: dict) -> dict:
    data: bytes = frame["bytes"]
    out = {"dir": frame["dir"], "length": len(data)}
    if len(data) <= 48:
        out["hex"] = data.hex()
    else:
        out["head"] = data[:16].hex()
        out["sha256"] = hashlib.sha256(data).hexdigest()
    return out


def record() -> dict:
    import ltchiptool.util.serialtool as serialtool
    from ltchiptool.soc.ln882h.util import ln882htool

    chip = Chip()
    FakeSerial.chip = chip
    serialtool.Serial = FakeSerial
    ln882htool.LN882H_YM_BAUDRATE = 115200

    work = Path(tempfile.mkdtemp())
    ramcode = work / "ramcode.bin"
    ramcode.write_bytes(RAMCODE)
    ln882htool.LN882H_BOOTRAM_FILE = str(ramcode)
    # The header names the file and its mtime: a fixed name and an unknown (0) mtime.
    os.path.getmtime = lambda _path: 0

    class NamedFile:
        def __init__(self, delete=True):
            self.f = open(work / "firmware.bin", "wb")

        def __enter__(self):
            return self.f

        def __exit__(self, *exc):
            self.f.close()

    ln882htool.NamedTemporaryFile = NamedFile

    # As ltchiptool's flash write of a UF2 drives it: link, load the RAM code,
    # write each run, reboot.
    tool = ln882htool.LN882hTool(port="fake", baudrate=115200)
    tool.link()
    tool.ram_boot()
    for offset, data in RUNS:
        tool.flash_write(offset=offset, stream=io.BytesIO(data))
    tool.disconnect()
    assert chip.ram == RAMCODE, "RAM code"
    for offset, data in RUNS:
        assert chip.flash[offset : offset + len(data)] == data, f"run at {offset:#x}"
    assert chip.rebooted, "reboot"

    return {
        "name": "ln882h",
        "reference": "ltchiptool 4.14.4 LN882hTool (link, ram_boot, flash_write, disconnect), write held at 115200",
        "chip": {"rom_version": ROM_VERSION, "flash_id": FLASH_ID},
        "flash_sha256": hashlib.sha256(bytes(chip.flash)).hexdigest(),
        "frames": [summarise(f) for f in chip.frames],
    }


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    result = record()
    (out / "ln882h.json").write_text(json.dumps(result, indent=1) + "\n")
    tx = sum(1 for f in result["frames"] if f["dir"] == "tx")
    print(f"ln882h: frames={len(result['frames'])} tx={tx}")


main()
