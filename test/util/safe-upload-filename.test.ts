import { describe, expect, it } from "vitest";
import { safeUploadFilename } from "../../src/util/safe-upload-filename.js";

describe("safeUploadFilename", () => {
  it("preserves underscores from uploaded filenames", () => {
    // The original bug report: uploading ``test_web_server_ota_esp32.yaml``
    // was producing a slug of ``testwebserverotaesp32``. The user's
    // intent is "import my working config", so the filename should
    // round-trip character-for-character.
    expect(safeUploadFilename("test_web_server_ota_esp32")).toBe(
      "test_web_server_ota_esp32"
    );
  });

  it("preserves case", () => {
    // Filenames don't go through ``esphome.name`` validation; the
    // user might prefer ``Kitchen-Sensor`` over ``kitchen-sensor``.
    expect(safeUploadFilename("Kitchen-Sensor")).toBe("Kitchen-Sensor");
  });

  it("preserves accented characters and non-Latin scripts", () => {
    // POSIX filesystems accept arbitrary UTF-8; Windows accepts
    // anything outside the explicit illegal set. A user with a
    // ``küche.yaml`` or ``厨房.yaml`` file should get to keep their
    // filename.
    expect(safeUploadFilename("küche")).toBe("küche");
    expect(safeUploadFilename("厨房")).toBe("厨房");
    expect(safeUploadFilename("café-iot")).toBe("café-iot");
  });

  it("preserves dots in the middle (sub-extensions and version markers)", () => {
    // ``my-device.local.yaml`` is a real shape — the leading and
    // trailing whitespace/dots get trimmed but interior dots stay.
    expect(safeUploadFilename("my-device.local")).toBe("my-device.local");
    expect(safeUploadFilename("device.v2")).toBe("device.v2");
  });

  it("strips path separators to keep the slug a single component", () => {
    // Backend's ``rel_path`` would reject the traversal anyway, but
    // we clean here so the error surfaces as a *content* problem
    // rather than a path one. The leading ``..`` also gets trimmed
    // by the surrounding-dots rule below — both rules cooperate to
    // make traversal-shaped uploads land as plain names.
    expect(safeUploadFilename("../etc/passwd")).toBe("etcpasswd");
    expect(safeUploadFilename("foo/bar")).toBe("foobar");
    expect(safeUploadFilename("foo\\bar")).toBe("foobar");
  });

  it("strips NUL and other C0 control characters", () => {
    // NUL is rejected outright by most filesystems; the rest render
    // unintelligibly in the device list.
    expect(safeUploadFilename("foo\x00bar")).toBe("foobar");
    expect(safeUploadFilename("foo\nbar")).toBe("foobar");
    expect(safeUploadFilename("foo\tbar")).toBe("foobar");
    expect(safeUploadFilename("\x01\x02\x03name")).toBe("name");
  });

  it("strips Windows-illegal punctuation", () => {
    // ``< > : " | ? *`` are illegal in Windows filenames; strip so a
    // config imported on Linux still flashes from a Windows host.
    expect(safeUploadFilename('foo<bar>baz:qux"|?*')).toBe("foobarbazqux");
  });

  it("strips ``#`` as a defense against unencoded navigation sites", () => {
    // ``encodeURIComponent`` *does* encode ``#`` to ``%23`` — but
    // ``configuration`` flows into multiple URL-building call sites,
    // and any one of them forgetting to wrap in ``encodeURIComponent``
    // would split the URL at the fragment boundary. Stripping ``#``
    // here once is cheaper than trusting every downstream consumer
    // to encode.
    expect(safeUploadFilename("foo#bar")).toBe("foobar");
  });

  it("suffixes Windows reserved device names with ``_``", () => {
    // ``CON``, ``PRN``, ``AUX``, ``NUL``, ``COM1``..``COM9``,
    // ``LPT1``..``LPT9`` are unwritable on Windows even with an
    // extension. Append ``_`` so the on-disk filename sidesteps the
    // reservation.
    expect(safeUploadFilename("CON")).toBe("CON_");
    expect(safeUploadFilename("con")).toBe("con_");
    expect(safeUploadFilename("Aux")).toBe("Aux_");
    expect(safeUploadFilename("COM1")).toBe("COM1_");
    expect(safeUploadFilename("LPT9")).toBe("LPT9_");
  });

  it("suffixes Windows reserved names that carry a sub-extension", () => {
    // The user's ``stem`` arrives with ``.yaml`` already stripped, but
    // a config like ``CON.txt.yaml`` lands here as ``CON.txt`` — and
    // ``CON.txt`` is *also* the console device on Windows. Match on
    // the part before the first dot and insert the suffix there so
    // ``CON.txt`` → ``CON_.txt`` (preserving the sub-extension).
    expect(safeUploadFilename("CON.txt")).toBe("CON_.txt");
    expect(safeUploadFilename("AUX.mqtt")).toBe("AUX_.mqtt");
    expect(safeUploadFilename("com1.backup")).toBe("com1_.backup");
    expect(safeUploadFilename("LPT9.v2.cfg")).toBe("LPT9_.v2.cfg");
  });

  it("leaves names that merely *contain* a reserved word alone", () => {
    // Only the bare reserved name is unwritable. ``console``,
    // ``aux-mqtt``, ``com10`` are all fine.
    expect(safeUploadFilename("console")).toBe("console");
    expect(safeUploadFilename("aux-mqtt")).toBe("aux-mqtt");
    expect(safeUploadFilename("com10")).toBe("com10");
    // ``console.txt`` starts with a real word that just happens to
    // share a prefix with ``CON``; the dot-split test above keys
    // off the *full* segment before the dot, not a startsWith.
    expect(safeUploadFilename("console.txt")).toBe("console.txt");
  });

  it("trims surrounding whitespace and dots", () => {
    // Windows silently strips trailing whitespace/dots at write time;
    // do it here so ``foo`` and ``foo `` and ``foo.`` can't collide.
    expect(safeUploadFilename("  device  ")).toBe("device");
    expect(safeUploadFilename(".device")).toBe("device");
    expect(safeUploadFilename("device.")).toBe("device");
    expect(safeUploadFilename("...device...")).toBe("device");
  });

  it("returns empty string for fully-stripped input", () => {
    expect(safeUploadFilename("")).toBe("");
    expect(safeUploadFilename("///")).toBe("");
    expect(safeUploadFilename("\x00\x00")).toBe("");
    expect(safeUploadFilename("...")).toBe("");
  });
});
