"""Record what bk7231tools puts on the wire for a whole flash, against a simulated chip.

The frontend's Beken engine is tested against these transcripts: run against a
simulated chip in the same state, it must send the same bytes in the same order.

Usage: record.py <out dir>, the directory of this file to refresh the fixtures
Run with an interpreter that has bk7231tools 2.1.2 and pyserial, the versions
the fixtures were recorded with.

The simulated chip is a model built from what bk7231tools expects to read back,
not from a real chip; it says nothing about timing or about what a real
bootloader does beyond that.
"""

import hashlib
import io
import json
import struct
import sys
from binascii import crc32
from pathlib import Path

import serial

FLASH_SIZE = 0x200000
SECTOR = 0x1000


def old_byte(i: int) -> int:
    """What the flash holds before the flash: never FF, so an erase shows."""
    return (i * 7 + 3) % 251


def new_byte(i: int) -> int:
    """The image's bytes, by offset in its run."""
    return (i * 31 + 7) % 253


def image_runs() -> list[tuple[int, bytes]]:
    """Three sectors (data, all FF, a partial one) and the small unaligned run
    a real build puts at the end of the app partition."""
    first = bytearray(new_byte(i) for i in range(2 * SECTOR + 1000))
    first[SECTOR : 2 * SECTOR] = b"\xff" * SECTOR
    tail = bytes(new_byte(i) for i in range(102))
    return [(0x11000, bytes(first)), (0x129F0A, tail)]


class Chip:
    def __init__(self, spec: dict) -> None:
        self.spec = spec
        self.full = spec["protocol"] == "FULL"
        self.flash = bytearray(old_byte(i) for i in range(FLASH_SIZE))
        self.sr = spec.get("sr", 0)
        # BASIC bootloaders protect the flash after a CRC until a LinkCheck.
        self.locked = False
        self.rx = bytearray()
        self.out = bytearray()
        self.frames: list[dict] = []

    # -- wire ---------------------------------------------------------------
    def feed(self, data: bytes) -> None:
        self.frames.append({"dir": "tx", "bytes": bytes(data)})
        self.rx += data
        while self._take():
            pass

    def _take(self) -> bool:
        rx = self.rx
        if len(rx) < 5:
            return False
        assert rx[:3] == b"\x01\xe0\xfc", rx[:8].hex()
        if rx[3] == 0xFF:
            if len(rx) < 8:
                return False
            assert rx[4] == 0xF4
            (size,) = struct.unpack("<H", rx[5:7])
            head, long = 7, True
        else:
            size, head, long = rx[3], 4, False
        if len(rx) < head + size:
            return False
        code = rx[head]
        payload = bytes(rx[head + 1 : head + size])
        del rx[: head + size]
        self._answer(code, long, payload)
        return True

    def _reply(self, code: int, long: bool, payload: bytes) -> None:
        if long:
            frame = b"\x04\x0e\xff\x01\xe0\xfc\xf4" + struct.pack("<HB", len(payload) + 1, code)
        else:
            frame = b"\x04\x0e" + bytes([len(payload) + 4]) + b"\x01\xe0\xfc" + bytes([code])
        frame += payload
        self.frames.append({"dir": "rx", "bytes": frame})
        self.out += frame

    # -- commands -----------------------------------------------------------
    def _writable(self) -> bool:
        if self.full:
            return not (self.sr & 0x7C)
        return not self.locked

    def _crc(self, start: int, end: int) -> int:
        if self.full:
            end += 1
        boot = self.spec.get("boot_crc")
        if boot is not None and start % FLASH_SIZE == 0 and end - start in (256, 257):
            return boot ^ 0xFFFFFFFF
        data = bytes(self.flash[(start + i) % FLASH_SIZE] for i in range(end - start))
        return crc32(data) ^ 0xFFFFFFFF

    def _answer(self, code: int, long: bool, p: bytes) -> None:
        if not long and code == 0x00:
            self.locked = False
            self._reply(0x01, False, b"\x00")
        elif not long and code == 0x03 and self.full:
            (addr,) = struct.unpack("<I", p)
            value = self.spec["chip_id"] if addr == 0x800000 else 0
            self._reply(0x03, False, struct.pack("<II", addr, value))
        elif not long and code == 0x0E:
            pass  # reboot: no answer
        elif not long and code == 0x10:
            start, end = struct.unpack("<II", p)
            self._reply(0x10, False, struct.pack("<I", self._crc(start, end)))
            if not self.full:
                self.locked = True
        elif not long and code == 0x11 and self.spec["protocol"] == "BASIC_TUYA":
            self._reply(0x11, False, self.spec["boot_version"].encode())
        elif long and code == 0x06:
            (start,) = struct.unpack("<I", p[:4])
            data = p[4:]
            if self._writable():
                for i, b in enumerate(data):
                    self.flash[(start + i) % FLASH_SIZE] &= b
            self._reply(0x06, True, struct.pack("<BIB", 0, start, len(data) & 0xFF))
        elif long and code == 0x07:
            (start,) = struct.unpack("<I", p[:4])
            data = p[4:]
            assert len(data) == SECTOR
            if self._writable():
                for i, b in enumerate(data):
                    self.flash[(start + i) % FLASH_SIZE] &= b
            self._reply(0x07, True, struct.pack("<BI", 0, start))
        elif long and code == 0x09:
            (start,) = struct.unpack("<I", p)
            data = bytes(self.flash[(start + i) % FLASH_SIZE] for i in range(SECTOR))
            self._reply(0x09, True, struct.pack("<BI", 0, start) + data)
        elif long and code == 0x0C and self.full:
            cmd = p[0]
            value = (self.sr >> 8) & 0xFF if cmd == 0x35 else self.sr & 0xFF
            self._reply(0x0C, True, bytes([0, cmd, value]))
        elif long and code == 0x0D and self.full:
            cmd = p[0]
            if len(p) == 2:
                self.sr = (self.sr & 0xFF00) | p[1]
                self._reply(0x0D, True, bytes([0, cmd, p[1]]))
            else:
                (value,) = struct.unpack("<H", p[1:3])
                self.sr = value
                self._reply(0x0D, True, struct.pack("<BBH", 0, cmd, value))
        elif long and code == 0x0E and self.full:
            fid = bytes.fromhex(self.spec["flash_id"])
            self._reply(0x0E, True, bytes([0, 0]) + fid)
        elif long and code == 0x0F:
            size, start = struct.unpack("<BI", p)
            assert size == 0x20
            if self._writable():
                base = (start % FLASH_SIZE) & ~(SECTOR - 1)
                self.flash[base : base + SECTOR] = b"\xff" * SECTOR
            self._reply(0x0F, True, bytes([0]) + p)
        else:
            raise AssertionError(f"command the chip does not know: {code:#x} long={long}")


class FakeSerial:
    """As much of pyserial as bk7231tools uses."""

    chip: Chip

    def __init__(self, port=None, baudrate=115200, timeout=None, **_) -> None:
        self.baudrate = baudrate
        self.timeout = timeout
        self.closed = False
        self.rts = self.dtr = True

    def write(self, data: bytes) -> int:
        self.chip.feed(data)
        return len(data)

    def flush(self) -> None:
        pass

    def read(self, size: int = 1) -> bytes:
        out = bytes(self.chip.out[:size])
        del self.chip.out[:size]
        return out

    def read_until(self, expected: bytes = b"\n", size=None) -> bytes:
        idx = self.chip.out.find(expected)
        end = len(self.chip.out) if idx < 0 else idx + len(expected)
        out = bytes(self.chip.out[:end])
        del self.chip.out[:end]
        return out

    def close(self) -> None:
        self.closed = True


VARIANTS = {
    # Both chips of the hardware pass speak the BootROM protocol.
    "bk7231n": dict(protocol="FULL", boot_crc=0xE14191BA, chip_id=0x7231C, flash_id="eb6015", sr=0x407C),
    "bk7238": dict(protocol="FULL", boot_crc=0x6BEB0924, chip_id=0x7238, flash_id="c84015", sr=0x007C),
    "bk7231t": dict(protocol="BASIC_TUYA", boot_crc=0xBA54C1B8, boot_version="1.0.5"),
    # No flash size in the table and no flash id: the size comes from the wrap-around probe.
    "bk7252": dict(protocol="BASIC_BEKEN", boot_crc=0x39F9B50C),
    "bk7231n-unknown-bootloader": dict(protocol="FULL", boot_crc=None, chip_id=0x7231C, flash_id="eb6015", sr=0),
    "basic-unknown-bootloader": dict(protocol="BASIC_BEKEN", boot_crc=None),
}


def summarise(frame: dict) -> dict:
    data: bytes = frame["bytes"]
    out = {"dir": frame["dir"], "length": len(data)}
    if len(data) <= 48:
        out["hex"] = data.hex()
    else:
        out["head"] = data[:16].hex()
        out["sha256"] = hashlib.sha256(data).hexdigest()
    return out


def record(name: str, spec: dict) -> dict:
    chip = Chip(spec)
    FakeSerial.chip = chip
    serial.Serial = FakeSerial  # before bk7231tools binds the name
    for mod in [m for m in sys.modules if m.startswith("bk7231tools")]:
        del sys.modules[mod]
    from bk7231tools.serial import BK7231Serial

    warnings: list[str] = []
    bk = BK7231Serial(port="fake", baudrate=115200, link_baudrate=115200)
    bk.warn = lambda *a: warnings.append(" ".join(map(str, a)))
    # As ltchiptool's flash_write_uf2 drives it.
    bk.connect()
    for offset, data in image_runs():
        for _ in bk.program_flash(io=io.BytesIO(data), io_size=len(data), start=offset, crc_check=True, dry_run=False, really_erase=True):
            pass
    bk.reboot_chip()

    for offset, data in image_runs():
        assert bytes(chip.flash[offset : offset + len(data)]) == data, f"{name}: image not in flash at {offset:#x}"
    return {
        "name": name,
        "reference": "bk7231tools 2.1.2, driven as ltchiptool 4.14.4 flash_write_uf2 does",
        "chip": spec,
        "detected": {
            "protocol": bk.protocol_type.name,
            "chip": bk.chip_type.name if bk.chip_type else None,
            "bootloader": bk.bootloader_type.name if bk.bootloader_type else None,
            "flash_size": bk.flash_size,
            "boot_version": bk.bk_boot_version,
        },
        "warnings": warnings,
        "flash_sha256": hashlib.sha256(bytes(chip.flash)).hexdigest(),
        "frames": [summarise(f) for f in chip.frames],
    }


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, spec in VARIANTS.items():
        result = record(name, spec)
        (out / f"{name}.json").write_text(json.dumps(result, indent=1) + "\n")
        tx = sum(1 for f in result["frames"] if f["dir"] == "tx")
        print(f"{name}: {result['detected']} frames={len(result['frames'])} tx={tx} warnings={len(result['warnings'])}")


main()
