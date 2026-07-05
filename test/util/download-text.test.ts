import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadAnsiText,
  downloadBlob,
  triggerDownload,
} from "../../src/util/download-text.js";

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

function withBrowserStubs<T>(fn: () => T): {
  result: T;
  anchor: FakeAnchor;
  url: {
    createObjectURL: ReturnType<typeof vi.fn>;
    revokeObjectURL: ReturnType<typeof vi.fn>;
  };
} {
  const anchor = new FakeAnchor();
  const url = {
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  };
  const stubs = {
    Blob: FakeBlob,
    URL: url,
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
    return { result: fn(), anchor, url };
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

  it("creates a text/plain Blob with the joined content and revokes its URL", () => {
    const { url } = withBrowserStubs(() =>
      downloadAnsiText(["hello", "[32mworld[0m"], "greeting.txt")
    );
    expect(FakeBlob.instances).toHaveLength(1);
    const blob = FakeBlob.instances[0];
    expect(blob.options?.type).toBe("text/plain");
    expect(blob.parts).toEqual(["hello\nworld"]);
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});

describe("downloadBlob", () => {
  it("wraps the payload in a Blob with the caller's MIME type and clicks an anchor", () => {
    const { anchor } = withBrowserStubs(() =>
      downloadBlob("esphome:\n  name: kitchen\n", "kitchen.yaml", "text/yaml")
    );
    expect(FakeBlob.instances).toHaveLength(1);
    const blob = FakeBlob.instances[0];
    expect(blob.options?.type).toBe("text/yaml");
    expect(blob.parts).toEqual(["esphome:\n  name: kitchen\n"]);
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.download).toBe("kitchen.yaml");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it("revokes the minted object URL after the click so the Blob doesn't leak", () => {
    const { anchor, url } = withBrowserStubs(() =>
      downloadBlob("payload", "file.bin", "application/octet-stream")
    );
    expect(url.createObjectURL).toHaveBeenCalledTimes(1);
    expect(url.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    // The click fires before the URL is revoked — the reverse order
    // would hand the browser a dead URL to download.
    expect(anchor.click.mock.invocationCallOrder[0]).toBeLessThan(
      url.revokeObjectURL.mock.invocationCallOrder[0]
    );
  });
});

describe("triggerDownload", () => {
  it("navigates an anchor to the URL so the browser streams it to disk", () => {
    const { anchor, url } = withBrowserStubs(() =>
      triggerDownload("/api/firmware/download?token=tok", "firmware.elf")
    );
    expect(anchor.href).toBe("/api/firmware/download?token=tok");
    expect(anchor.download).toBe("firmware.elf");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    // No Blob is constructed — the file is never buffered in memory,
    // so there is no object URL to mint or revoke either.
    expect(FakeBlob.instances).toHaveLength(0);
    expect(url.createObjectURL).not.toHaveBeenCalled();
  });
});
