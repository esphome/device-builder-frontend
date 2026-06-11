/** Synthetic drag event for happy-dom tests.
 *
 *  happy-dom lacks DragEvent; the production code only reads
 *  ``dataTransfer`` and ``defaultPrevented``, so a plain Event with a
 *  stub suffices. */
export function dragEvent(
  type: string,
  opts: { files?: File[]; types?: string[] } = {}
): Event & { dataTransfer: { types: string[]; files: File[]; dropEffect: string } } {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: {
      types: opts.types ?? ["Files"],
      files: opts.files ?? [],
      dropEffect: "",
    },
  });
  return e as ReturnType<typeof dragEvent>;
}
