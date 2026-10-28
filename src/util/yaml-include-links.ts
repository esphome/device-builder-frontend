/**
 * Ctrl/Cmd+click links on ``!include`` targets in the YAML editor.
 *
 * ESPHome resolves an include relative to the including file's folder, so
 * targets are resolved against *basePath* (the config-relative path of the
 * file being edited). Targets outside the config dir, absolute paths and
 * ``${substitution}``-built paths aren't linked.
 */
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** ``!include path`` / ``!include {file: path}``, path optionally quoted. */
const INCLUDE_RE = /!include\s+(?:\{\s*file:\s*)?(["']?)([^\s"'{},#]+\.ya?ml)\1/g;

export interface IncludeTarget {
  /** Offsets of the path text within the line. */
  from: number;
  to: number;
  /** The path exactly as written. */
  ref: string;
}

/** Every linkable ``!include`` path in one line of YAML. */
export function findIncludeTargets(line: string): IncludeTarget[] {
  const comment = line.search(/(^|\s)#/);
  const code = comment < 0 ? line : line.slice(0, comment);
  const out: IncludeTarget[] = [];
  for (const m of code.matchAll(INCLUDE_RE)) {
    const ref = m[2];
    if (ref.includes("$")) continue;
    const from = m.index + m[0].lastIndexOf(ref);
    out.push({ from, to: from + ref.length, ref });
  }
  return out;
}

/** *ref* resolved against the folder of *basePath*, POSIX-relative to the
 *  config dir; null when absolute or outside it. */
export function resolveIncludePath(basePath: string, ref: string): string | null {
  if (ref.startsWith("/") || /^[a-z]:/i.test(ref)) return null;
  const parts = basePath.split("/").slice(0, -1);
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

const linkMark = (title: string) =>
  Decoration.mark({ class: "cm-include-link", attributes: { title } });

function buildDecorations(view: EditorView, title: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const mark = linkMark(title);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      for (const t of findIncludeTargets(line.text)) {
        builder.add(line.from + t.from, line.from + t.to, mark);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * Underline include targets and open one on Ctrl/Cmd+click.
 * *getBasePath* is read per click so a reused editor follows its file.
 */
export function includeLinks(
  getBasePath: () => string,
  open: (path: string) => void,
  title: string
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, title);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, title);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const path = includePathAt(view, pos, getBasePath());
      if (path === null) return false;
      event.preventDefault();
      open(path);
      return true;
    },
  });
  const theme = EditorView.baseTheme({
    ".cm-include-link": {
      textDecoration: "underline dotted",
      textUnderlineOffset: "3px",
    },
  });
  return [plugin, click, theme];
}

/** The resolved include target under document offset *pos*, if any. */
export function includePathAt(
  view: EditorView,
  pos: number,
  basePath: string
): string | null {
  const line = view.state.doc.lineAt(pos);
  const col = pos - line.from;
  const hit = findIncludeTargets(line.text).find((t) => col >= t.from && col <= t.to);
  return hit ? resolveIncludePath(basePath, hit.ref) : null;
}
