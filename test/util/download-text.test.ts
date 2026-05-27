import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAnsiText, downloadBase64Binary } from "../../src/util/download-text.js";

/* The runtime test environment is Node, so we stub the bits of the
   browser API the helper touches. The download mechanics (anchor +
   ``URL.createObjectURL``) are exercised end-to-end in the real
   browser by the dialog smoke tests; here we focus on the
   string-shape contract that callers depend on (ANSI stripping,
   line-join, filename plumbing). */

class FakeBlob {
  static instances: FakeBlob[] = [];
  constructor(
    public parts: BlobPart[],
    public options?: BlobPropertyBag
  ) {
    FakeBlob.instances.push(this);
  }
}

class FakeAnchor {
  href = "";
  download = "";
  click = vi.fn();
}

afterEach(() => {
  FakeBlob.instances = [];
  vi.restoreAllMocks();
});

function withBrowserStubs<T>(fn: () => T): { result: T; anchor: FakeAnchor } {
  const anchor = new FakeAnchor();
  const stubs = {
    Blob: FakeBlob,
    URL: { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() },
    document: { createElement: vi.fn(() => anchor) },
  };
  const g = globalThis as Record<string, unknown>;
  const restore: Array<() => void> = [];
  for (const [key, value] of Object.entries(stubs)) {
    const prev = g[key];
    g[key] = value;
    restore.push(() => {
      g[key] = prev;
    });
  }
  try {
    return { result: fn(), anchor };
  } finally {
    for (const fn of restore) fn();
  }
}

describe("downloadAnsiText", () => {
  it("strips ANSI escape sequences before saving", () => {
    const { result, anchor } = withBrowserStubs(() =>
      downloadAnsiText(["plain", "[31mred[0m", "[1;33mwarn[0m"], "out.txt")
    );
    expect(result).toBe("plain\nred\nwarn");
    expect(anchor.download).toBe("out.txt");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it("joins lines with a single \\n (no trailing newline)", () => {
    const { result } = withBrowserStubs(() => downloadAnsiText(["a", "b", "c"], "x.txt"));
    expect(result).toBe("a\nb\nc");
  });

  it("returns an empty string when no lines are passed", () => {
    const { result } = withBrowserStubs(() => downloadAnsiText([], "empty.txt"));
    expect(result).toBe("");
  });

  it("strips trailing line terminators so each entry stays on its own row", () => {
    /* The firmware-job follow path delivers lines with the original
       ``\n`` / ``\r\n`` baked in, plus the occasional bare ``\r``
       (esptool / PlatformIO progress updates use carriage-returns
       for in-place line replacement, and ansi-log already documents
       that shape). All three terminators must collapse so the saved
       file reads cleanly. */
    const { result } = withBrowserStubs(() =>
      downloadAnsiText(["one\n", "two\r\n", "three", "four\r", "five\r\r\n"], "log.txt")
    );
    expect(result).toBe("one\ntwo\nthree\nfour\nfive");
  });

  it("preserves bracketed text that isn't an ANSI escape (no ESC byte)", () => {
    const { result } = withBrowserStubs(() =>
      downloadAnsiText(["[INFO] startup", "[1;31m not-an-escape"], "log.txt")
    );
    /* stripAnsi only matches when ESC () is present, so plain
       bracketed text — which shows up in real ESPHome logs as level
       prefixes like ``[I][component]`` — is preserved verbatim. */
    expect(result).toBe("[INFO] startup\n[1;31m not-an-escape");
  });

  it("creates a text/plain Blob with the joined content", () => {
    withBrowserStubs(() => downloadAnsiText(["hello", "[32mworld[0m"], "greeting.txt"));
    expect(FakeBlob.instances).toHaveLength(1);
    const blob = FakeBlob.instances[0];
    expect(blob.options?.type).toBe("text/plain");
    expect(blob.parts).toEqual(["hello\nworld"]);
  });
});

describe("downloadBase64Binary", () => {
  it("decodes the base64 payload and saves as application/octet-stream", () => {
    /* ``AAECAw==`` decodes to the four-byte sequence 0x00 0x01 0x02 0x03. */
    const { anchor } = withBrowserStubs(() =>
      downloadBase64Binary("AAECAw==", "firmware.bin")
    );
    expect(anchor.download).toBe("firmware.bin");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(FakeBlob.instances).toHaveLength(1);
    const blob = FakeBlob.instances[0];
    expect(blob.options?.type).toBe("application/octet-stream");
    expect(blob.parts).toHaveLength(1);
    const part = blob.parts[0];
    expect(part).toBeInstanceOf(Uint8Array);
    expect(Array.from(part as Uint8Array)).toEqual([0x00, 0x01, 0x02, 0x03]);
  });

  it("creates and revokes an object URL for the Blob", () => {
    const createSpy = vi.fn(() => "blob:fake");
    const revokeSpy = vi.fn();
    const stubs = {
      Blob: FakeBlob,
      URL: { createObjectURL: createSpy, revokeObjectURL: revokeSpy },
      document: { createElement: vi.fn(() => new FakeAnchor()) },
    };
    const g = globalThis as Record<string, unknown>;
    const prev: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stubs)) {
      prev[key] = g[key];
      g[key] = value;
    }
    try {
      downloadBase64Binary("aGVsbG8=", "hello.bin");
    } finally {
      for (const [key, value] of Object.entries(prev)) g[key] = value;
    }
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake");
  });

  it("accepts an empty payload (zero-byte download)", () => {
    /* An empty base64 string decodes to zero bytes. Helpful for
       defensive call sites that pass through whatever the backend
       returned without their own length gate. */
    const { anchor } = withBrowserStubs(() => downloadBase64Binary("", "empty.bin"));
    expect(anchor.download).toBe("empty.bin");
    const blob = FakeBlob.instances[0];
    const part = blob.parts[0];
    expect(part).toBeInstanceOf(Uint8Array);
    expect((part as Uint8Array).length).toBe(0);
  });
});
