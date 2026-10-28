/**
 * Ctrl/Cmd+click links on ``!include`` targets in the YAML editor.
 *
 * ESPHome resolves an include relative to the including file's folder, so
 * targets are resolved against *basePath* (the config-relative path of the
 * file being edited). Targets outside the config dir, absolute paths and
 * ``${substitution}``-built paths aren't linked.
 */
import { type Extension, type Line, RangeSetBuilder, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** A path ending in ``.yaml`` / ``.yml`` (any case), optionally quoted, ending there:
 *  ``base.yaml.backup`` is another file. Same rules as the backend's rename. */
const PATH = String.raw`(["']?)([^\s"'{},#]+\.[yY][aA]?[mM][lL])\1(?=[\s"'},]|$)`;
/** ``!include path`` / ``!include {file: path}``. */
const INCLUDE_RE = new RegExp(String.raw`!include\s+(?:\{\s*file:\s*)?` + PATH, "g");
/** Block form: ``!include`` ending a line, ``file: path`` on a deeper next line. */
const BARE_TAG_RE = /!include\s*$/;
const FILE_KEY_RE = new RegExp(String.raw`^\s*file:\s*` + PATH);

export interface IncludeTarget {
  /** Offsets of the path text within the line. */
  from: number;
  to: number;
  /** The path exactly as written. */
  ref: string;
}

const codeOf = (line: string) => {
  const comment = line.search(/(^|\s)#/);
  return comment < 0 ? line : line.slice(0, comment);
};

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Every linkable ``!include`` path in one line of YAML; *prev* is the previous
 *  non-blank line, for the block form. */
export function findIncludeTargets(line: string, prev = ""): IncludeTarget[] {
  const code = codeOf(line);
  const out: IncludeTarget[] = [];
  const add = (ref: string, from: number) => {
    if (!ref.includes("$")) out.push({ from, to: from + ref.length, ref });
  };
  for (const m of code.matchAll(INCLUDE_RE)) add(m[2], m.index + m[0].lastIndexOf(m[2]));
  const block = FILE_KEY_RE.exec(code);
  if (
    block &&
    BARE_TAG_RE.test(codeOf(prev).trimEnd()) &&
    indentOf(line) > indentOf(prev)
  ) {
    add(block[2], block[0].lastIndexOf(block[2]));
  }
  return out;
}

/** The include targets of *line*, with the previous non-blank line as context. */
function lineTargets(doc: Text, line: Line): IncludeTarget[] {
  let n = line.number - 1;
  while (n >= 1 && doc.line(n).text.trim() === "") n--;
  return findIncludeTargets(line.text, n >= 1 ? doc.line(n).text : "");
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
      for (const t of lineTargets(view.state.doc, line)) {
        builder.add(line.from + t.from, line.from + t.to, mark);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Mirrors the Ctrl/Cmd key state onto the editor as ``data-include-mod``.
 *  Window listeners so it reacts while hovering an unfocused editor. */
const modifierTracker = ViewPlugin.fromClass(
  class {
    private readonly win: Window;
    constructor(private readonly view: EditorView) {
      this.win = view.dom.ownerDocument.defaultView ?? window;
      for (const type of ["keydown", "keyup", "mousemove"] as const) {
        this.win.addEventListener(type, this.sync);
      }
      this.win.addEventListener("blur", this.clear);
    }
    sync = (e: KeyboardEvent | MouseEvent) => {
      this.view.dom.toggleAttribute("data-include-mod", e.ctrlKey || e.metaKey);
    };
    clear = () => this.view.dom.removeAttribute("data-include-mod");
    destroy() {
      for (const type of ["keydown", "keyup", "mousemove"] as const) {
        this.win.removeEventListener(type, this.sync);
      }
      this.win.removeEventListener("blur", this.clear);
    }
  }
);

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
    // Ctrl/Cmd held: the hovered link turns into a real link (VS Code style).
    "&[data-include-mod] .cm-include-link:hover": {
      textDecorationStyle: "solid",
      cursor: "pointer",
    },
  });
  return [plugin, modifierTracker, click, theme];
}

/** The resolved include target under document offset *pos*, if any. */
export function includePathAt(
  view: EditorView,
  pos: number,
  basePath: string
): string | null {
  const line = view.state.doc.lineAt(pos);
  const col = pos - line.from;
  const hit = lineTargets(view.state.doc, line).find((t) => col >= t.from && col <= t.to);
  return hit ? resolveIncludePath(basePath, hit.ref) : null;
}
