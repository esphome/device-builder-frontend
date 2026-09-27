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

  it("keeps keys by position when every row is re-parsed", () => {
    const { keys, a, b, c } = seeded("a", "b", "c");
    expect(keysOf(keys, [row("a"), row("b"), row("c")])).toEqual([a, b, c]);
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
});
