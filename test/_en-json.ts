import enMessages from "../src/translations/en.json";

/** A dotted key's English copy, or undefined when en.json lacks it. */
export function english(key: string): unknown {
  let node: unknown = enMessages;
  for (const part of key.split(".")) {
    node =
      typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined;
  }
  return node;
}
