import { describe, expect, it } from "vitest";
import { RowKeys } from "../../../../src/components/device/automation-editor/row-keys.js";
import {
  removeAt,
  replaceAt,
  swap,
} from "../../../../src/components/device/automation-editor/serialise.js";

interface Row {
  name: string;
}
const row = (name: string): Row => ({ name });

const keysOf = (keys: RowKeys<Row>, rows: readonly Row[]) => keys.keysFor(rows);

function seeded(...names: string[]) {
  const keys = new RowKeys<Row>();
  const rows = names.map(row);
  const [a, b, c] = keysOf(keys, rows);
  return { keys, rows, a, b, c };
}

describe("RowKeys", () => {
  it("gives every row of a first list its own key", () => {
    const { a, b, c } = seeded("a", "b", "c");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("has no keys for an empty list", () => {
    expect(keysOf(new RowKeys<Row>(), [])).toEqual([]);
  });

  it("keeps a row's key when a field in it is edited", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = replaceAt(rows, 1, { ...rows[1] });
    expect(keysOf(keys, next)).toEqual([a, b, c]);
  });

  it("drops a deleted row's key and keeps the others", () => {
    const { keys, rows, b, c } = seeded("a", "b", "c");
    expect(keysOf(keys, removeAt(rows, 0))).toEqual([b, c]);
  });

  it("moves the keys with their rows on a reorder", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keysOf(keys, swap(rows, 0, 1))).toEqual([b, a, c]);
  });

  it("gives an added row a new key", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = keysOf(keys, [...rows, row("d")]);
    expect(next.slice(0, 3)).toEqual([a, b, c]);
    expect([a, b, c]).not.toContain(next[3]);
  });

  it("never hands a deleted row's key to a row added later", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const shorter = removeAt(rows, 2);
    keys.keysFor(shorter);
    const [, , added] = keysOf(keys, [...shorter, row("d")]);
    expect([a, b, c]).not.toContain(added);
  });

  it("keeps the key of a row whose kind changed in place", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keysOf(keys, replaceAt(rows, 0, row("other kind")))).toEqual([a, b, c]);
  });

  it("gives a row added above the others a new key, not the one its index had", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = keysOf(keys, [row("d"), ...rows]);
    expect(next.slice(1)).toEqual([a, b, c]);
    expect([a, b, c]).not.toContain(next[0]);
  });

  it("hands back the same keys when asked again for the same list", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keysOf(keys, rows)).toEqual([a, b, c]);
  });

  it("keeps both keys of an object listed twice when asked again", () => {
    const keys = new RowKeys<Row>();
    const twin = row("twin");
    const first = keysOf(keys, [twin, twin]);
    expect(keysOf(keys, [twin, twin])).toEqual(first);
  });

  it("keys the same object listed twice as two rows", () => {
    const keys = new RowKeys<Row>();
    const twin = row("twin");
    const [first, second] = keysOf(keys, [twin, twin]);
    expect(first).not.toBe(second);
  });

  it("keeps an edited row's key when the row above it is deleted next", () => {
    const { keys, rows, b, c } = seeded("a", "b", "c");
    const edited = replaceAt(rows, 1, { ...rows[1] });
    keys.keysFor(edited);
    expect(keysOf(keys, removeAt(edited, 0))).toEqual([b, c]);
  });

  describe("a list read again, every row a new object", () => {
    const reread = (...names: string[]) => names.map(row);

    it("keeps every key when nothing changed", () => {
      const { keys, a, b, c } = seeded("a", "b", "c");
      expect(keysOf(keys, reread("a", "b", "c"))).toEqual([a, b, c]);
    });

    it("knows a row whose fields come in another order", () => {
      const keys = new RowKeys<object>();
      const [a, b] = keys.keysFor([
        { kind: "delay", params: { id: "1s", extra: true } },
        { kind: "delay", params: { id: "2s" } },
      ]);
      const next = keys.keysFor([
        { kind: "delay", params: { id: "2s" } },
        { params: { extra: true, id: "1s" }, kind: "delay" },
      ]);
      expect(next).toEqual([b, a]);
    });

    it("knows a row made in the editor, read back without its empty lists", () => {
      const keys = new RowKeys<object>();
      const [a, b] = keys.keysFor([
        { action_id: "delay", params: { id: "1s" }, children: {}, conditions: [] },
        { action_id: "logger.log", params: {}, children: {}, conditions: [] },
      ]);
      const next = keys.keysFor([
        { action_id: "logger.log" },
        { action_id: "delay", params: { id: "1s" } },
      ]);
      expect(next).toEqual([b, a]);
    });

    it("tells a row with a child list from one without", () => {
      const keys = new RowKeys<object>();
      const [a, b] = keys.keysFor([
        { action_id: "if", children: { then: [{ action_id: "delay" }] } },
        { action_id: "if", children: {} },
      ]);
      const next = keys.keysFor([
        { action_id: "if" },
        { action_id: "if", children: { then: [{ action_id: "delay" }] } },
      ]);
      expect(next).toEqual([b, a]);
    });

    it("keeps the rows' keys when a row is added above them", () => {
      const { keys, a, b, c } = seeded("a", "b", "c");
      const next = keysOf(keys, reread("new", "a", "b", "c"));
      expect(next.slice(1)).toEqual([a, b, c]);
      expect([a, b, c]).not.toContain(next[0]);
    });

    it("keeps the rows' keys when a row is added between them", () => {
      const { keys, a, b, c } = seeded("a", "b", "c");
      const next = keysOf(keys, reread("a", "new", "b", "c"));
      expect([next[0], next[2], next[3]]).toEqual([a, b, c]);
      expect([a, b, c]).not.toContain(next[1]);
    });

    it("keeps the other rows' keys when a row is removed", () => {
      const { keys, b, c } = seeded("a", "b", "c");
      expect(keysOf(keys, reread("b", "c"))).toEqual([b, c]);
    });

    it("moves the keys with rows that swapped places", () => {
      const { keys, a, b, c } = seeded("a", "b", "c");
      expect(keysOf(keys, reread("b", "a", "c"))).toEqual([b, a, c]);
    });

    it("keeps the key of a row edited where it is", () => {
      const { keys, a, b, c } = seeded("a", "b", "c");
      expect(keysOf(keys, reread("a", "b edited", "c"))).toEqual([a, b, c]);
    });

    it("matches rows of the same content in order", () => {
      const { keys, a, b, c } = seeded("same", "same", "c");
      expect(keysOf(keys, reread("same", "same", "c"))).toEqual([a, b, c]);
      expect(keysOf(keys, reread("same", "c"))).toEqual([a, c]);
    });
  });

  it("keeps an edited row's own key when its new content is another row's", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = replaceAt(rows, 0, row("b"));
    expect(keysOf(keys, next)).toEqual([a, b, c]);
  });
});
