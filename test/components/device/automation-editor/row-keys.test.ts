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

function seeded(...names: string[]) {
  const keys = new RowKeys<Row>();
  const rows = names.map(row);
  const [a, b, c] = keys.reconcile(rows);
  return { keys, rows, a, b, c };
}

describe("RowKeys", () => {
  it("gives every row of a first list its own key", () => {
    const { a, b, c } = seeded("a", "b", "c");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("has no keys for an empty list", () => {
    expect(new RowKeys<Row>().reconcile([])).toEqual([]);
  });

  it("keeps a row's key when a field in it is edited", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = replaceAt(rows, 1, { ...rows[1] });
    expect(keys.reconcile(next)).toEqual([a, b, c]);
  });

  it("drops a deleted row's key and keeps the others", () => {
    const { keys, rows, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile(removeAt(rows, 0))).toEqual([b, c]);
  });

  it("moves the keys with their rows on a reorder", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile(swap(rows, 0, 1))).toEqual([b, a, c]);
  });

  it("gives an added row a new key", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const next = keys.reconcile([...rows, row("d")]);
    expect(next.slice(0, 3)).toEqual([a, b, c]);
    expect([a, b, c]).not.toContain(next[3]);
  });

  it("never hands a deleted row's key to a row added later", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    const shorter = removeAt(rows, 2);
    keys.reconcile(shorter);
    const [, , added] = keys.reconcile([...shorter, row("d")]);
    expect([a, b, c]).not.toContain(added);
  });

  it("keeps the key of a row whose kind changed in place", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile(replaceAt(rows, 0, row("other kind")))).toEqual([a, b, c]);
  });

  it("keeps keys by position when every row is re-parsed", () => {
    const { keys, a, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile([row("a"), row("b"), row("c")])).toEqual([a, b, c]);
  });

  it("keys the extra rows of a longer re-parse as new", () => {
    const { keys, a, b, c } = seeded("a", "b", "c");
    const next = keys.reconcile([row("a"), row("b"), row("c"), row("d")]);
    expect(next.slice(0, 3)).toEqual([a, b, c]);
    expect([a, b, c]).not.toContain(next[3]);
  });

  it("changes nothing when the parent hands the same list back", () => {
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile(rows)).toEqual([a, b, c]);
  });

  it("follows the list the parent kept when it dropped an edit", () => {
    // The list asked to delete row 0 but the parent was read only, so the
    // next list it hands over is the old rows with a field edited.
    const { keys, rows, a, b, c } = seeded("a", "b", "c");
    expect(keys.reconcile(replaceAt(rows, 2, { ...rows[2] }))).toEqual([a, b, c]);
  });

  it("keys the same object listed twice as two rows", () => {
    const keys = new RowKeys<Row>();
    const twin = row("twin");
    const [first, second] = keys.reconcile([twin, twin]);
    expect(first).not.toBe(second);
  });

  it("keeps an edited row's key when the row above it is deleted next", () => {
    const { keys, rows, b, c } = seeded("a", "b", "c");
    const edited = replaceAt(rows, 1, { ...rows[1] });
    keys.reconcile(edited);
    expect(keys.reconcile(removeAt(edited, 0))).toEqual([b, c]);
  });
});
