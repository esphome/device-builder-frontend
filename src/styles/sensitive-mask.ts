import { unsafeCSS } from "lit";

/**
 * The bullet styling every masked-credential surface shares — the editor's
 * CodeMirror decorations and the YAML diff's masked spans sit side by side
 * in the same pane, so a drift in glyph density is user-visible.
 *
 * Standard property is `text-security` (CSS Working Draft); the `-webkit-`
 * prefix is what actually ships in browsers today. Firefox accepts the
 * prefixed form since 125; Chromium/Safari have shipped it for years. We
 * set both so a future un-prefix doesn't regress. The letter-spacing nudge
 * keeps the bullets from mashing together — purely cosmetic, mirrors how
 * bullets render in a native `<input type="password">`.
 */
export const SENSITIVE_MASK_DECLARATIONS = {
  "-webkit-text-security": "disc",
  "text-security": "disc",
  "letter-spacing": "0.5px",
} as const;

/** The same declarations as a rule body for Lit `css` templates. */
export const sensitiveMaskDeclarationsCss = unsafeCSS(
  Object.entries(SENSITIVE_MASK_DECLARATIONS)
    .map(([property, value]) => `${property}: ${value};`)
    .join("\n")
);
