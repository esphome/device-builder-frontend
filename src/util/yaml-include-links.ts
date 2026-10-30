/**
 * Ctrl/Cmd+click links on ``!include`` targets in the YAML editor.
 *
 * ESPHome resolves an include relative to the including file's folder, so
 * targets are resolved against *basePath* (the config-relative path of the
 * file being edited). Targets outside the config dir, absolute paths and
 * ``${substitution}``-built paths aren't linked.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isApplePlatform } from "./apple-platform.js";
import { readKeyText } from "./yaml-ast.js";

/** A path ending in ``.yaml`` / ``.yml`` (any case): same rules as the backend's
 *  rename. Escaped (``\``) and ``${…}``-built paths aren't linked. */
const PATH_RE = /^[^\s"'{}[\],#$\\]+\.ya?ml$/i;

export interface IncludeTarget {
  /** Document offsets of the path text, inside any quotes. */
  from: number;
  to: number;
  /** The path exactly as written. */
  ref: string;
}

const isScalar = (node: SyntaxNode) =>
  node.name === "Literal" || node.name === "QuotedLiteral";

/** The scalar holding an ``!include``'s path: the tagged value itself, or the
 *  ``file`` value of the tagged mapping (not a nested ``vars: {file: …}``). */
function pathNode(state: EditorState, tagged: SyntaxNode): SyntaxNode | null {
  let value = tagged.getChild("Tag")?.nextSibling;
  while (value?.name === "Comment") value = value.nextSibling;
  if (!value) return null;
  if (isScalar(value)) return value;
  if (value.name !== "FlowMapping" && value.name !== "BlockMapping") return null;
  for (const pair of value.getChildren("Pair")) {
    const key = pair.getChild("Key");
    if (key && readKeyText(state, key) === "file") {
      const file = pair.lastChild;
      return file && isScalar(file) ? file : null;
    }
  }
  return null;
}

/** Every linkable ``!include`` path overlapping *from*–*to*, read from the
 *  editor's YAML tree so quoted strings, block scalars and comments don't count. */
export function findIncludeTargets(
  state: EditorState,
  from = 0,
  to = state.doc.length
): IncludeTarget[] {
  const out: IncludeTarget[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "Tagged") return;
      const tag = node.node.getChild("Tag");
      if (!tag || state.doc.sliceString(tag.from, tag.to) !== "!include") return;
      const path = pathNode(state, node.node);
      if (!path) return;
      const quoted = path.name === "QuotedLiteral" ? 1 : 0;
      const start = path.from + quoted;
      const end = path.to - quoted;
      const ref = state.doc.sliceString(start, end);
      if (end >= from && start <= to && PATH_RE.test(ref)) {
        out.push({ from: start, to: end, ref });
      }
    },
  });
  return out.sort((a, b) => a.from - b.from);
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
  // A fold can split one include across two visible ranges; decorate it once.
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (const t of findIncludeTargets(view.state, from, to)) {
      if (t.from <= last) continue;
      builder.add(t.from, t.to, mark);
      last = t.from;
    }
  }
  return builder.finish();
}

/** ⌘ on Apple platforms, where Ctrl+click opens the context menu; Ctrl elsewhere. */
const linkModifier = (e: KeyboardEvent | MouseEvent) =>
  isApplePlatform() ? e.metaKey : e.ctrlKey;

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
      this.view.dom.toggleAttribute("data-include-mod", linkModifier(e));
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
        // the parser fills in the tree after the edit that triggered it
        if (
          u.docChanged ||
          u.viewportChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = buildDecorations(u.view, title);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!linkModifier(event) || event.button !== 0) return false;
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
  const hit = findIncludeTargets(view.state, pos, pos).find(
    (t) => pos >= t.from && pos <= t.to
  );
  return hit ? resolveIncludePath(basePath, hit.ref) : null;
}
