import { decodedFrameSymbol } from "./crash-detector.js";

/**
 * Issue-title derivation: pick the frame a crash is worth being named
 * after and render it short enough for a GitHub title. Kept off
 * crash-report so the title rules stay readable on their own; it takes
 * primitives rather than a report so nothing here depends on assembly.
 */

// What GitHub accepts in an issue title, and the floor below which a title
// says no more than the generic one it replaces ("crash", "nothing").
export const MAX_TITLE_LENGTH = 100;
export const MIN_TITLE_LENGTH = 8;

/** True when a title is specific enough to file an issue under. */
export function isFilableTitle(title: string): boolean {
  return title.trim().length >= MIN_TITLE_LENGTH;
}

/** A title cut to what GitHub accepts. Applied at every point a title is
 *  produced, so the field, the issue and the download can't disagree. */
export function clampTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 3)}...`
    : title;
}

// Frames naming the machinery that reached a crash rather than the crash.
// Each appeared as the top frame of a real report, above the useful one.
const NOISE_FRAME_RES = [
  // Panic / abort / assert handlers, esp-idf and esp8266.
  /^(?:panic_abort|esp_system_abort|esp_vApplicationTickHook|__assert_func|abort|_esp_error_check_failed|user_fatal_exception_handler|__wrap_system_restart_local)\b/,
  // Idle task and scheduler startup: what a core parked on, not a fault.
  /^(?:esp_cpu_wait_for_intr|xt_utils_wait_for_intr|vTaskStartScheduler|prvCreateIdleTasks)\b/,
  // esp8266 entry / continuation trampolines.
  /^(?:call_user_start|app_entry_redefinable|cont_ret|cont_continue)\b/,
  // C++ runtime and allocator: an allocation that threw should name the
  // caller that asked for the memory, not `malloc`.
  /^(?:std::|__cxa_|__wrap___cxa_|__wrap__ZSt|_Unwind_|operator new|operator delete|malloc|calloc|realloc)/,
  // Lambda trampolines gcc emitted; the frame below names the component
  // that invoked the lambda. Tested against the template-stripped symbol
  // (see crashSymbol) — anchoring alone wouldn't do, since a closure type
  // spells its own `::{lambda…}` inside the argument list.
  /(?:^|::)_FUN\b|(?:^|::)\{lambda/,
];

// A trailing cv-qualifier, which is not part of the name.
const TRAILING_CONST_RE = /\s+const$/;

// Operator names spelled with the delimiters the strippers balance, longest
// spelling first. `operator<<` would otherwise open a template depth that
// never closes and take the rest of the symbol with it.
const OPERATOR_NAME_RE =
  /\boperator\s*(?:<=>|<<=|>>=|->\*|<<|>>|<=|>=|->|\(\)|\[\]|[<>])/;

// Drop everything between balanced delimiters. Argument lists and template
// parameters nest, so a regex mangles `FixedVector<...>::cleanup_`.
function stripBalanced(text: string, open: string, close: string): string {
  let depth = 0;
  let out = "";
  for (const char of text) {
    if (char === open) depth++;
    else if (char === close) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

// A symbol's qualified name, with the argument list and template
// parameters it carries removed.
function bareName(symbol: string): string {
  return stripBalanced(stripBalanced(symbol, "(", ")"), "<", ">");
}

// A symbol short enough for an issue title: no argument list, no template
// parameters, and at most the innermost two namespace segments.
function shortenSymbol(symbol: string): string {
  const operator = OPERATOR_NAME_RE.exec(symbol);
  // An operator's own name is spelled in the delimiters the strippers
  // balance, so only the qualified path left of it goes through them.
  const path = operator ? symbol.slice(0, operator.index) : symbol;
  const parts = bareName(path)
    .replace(TRAILING_CONST_RE, "")
    .trim()
    .split("::")
    .filter(Boolean);
  // `esphome::` prefixes every one of our own frames; the component
  // namespace below it is what identifies the code.
  if (parts[0] === "esphome") parts.shift();
  if (operator) parts.push(operator[0]);
  return parts.slice(-2).join("::");
}

/**
 * The topmost decoded frame that isn't panic or runtime machinery; ""
 * when every frame is noise or none decoded. esp8266 dumps are a stack
 * scrape, so there this is a best guess rather than the faulting frame.
 */
export function crashSymbol(decodedFrames: string[]): string {
  for (const frame of decodedFrames) {
    const symbol = decodedFrameSymbol(frame);
    if (!symbol) continue;
    // Judged on the bare name: a closure type reaches a real frame as a
    // template argument or a call argument (`Bar<setup()::{lambda()#1}>::run`,
    // `Bar::run(setup()::{lambda()#1})`), and either would otherwise read as
    // the `{lambda…}::_FUN` trampoline it embeds.
    if (NOISE_FRAME_RES.some((re) => re.test(bareName(symbol)))) continue;
    const short = shortenSymbol(symbol);
    if (short) return short;
  }
  return "";
}

/**
 * Suggested issue title: what the crash handler blamed, where it happened,
 * and the *platform* (the bug form's dropdown value). "" when no frame is
 * worth naming — two crashes sharing a frame are told apart by *reason*.
 */
export function suggestIssueTitle(
  decodedFrames: string[],
  platform: string,
  reason = ""
): string {
  const symbol = crashSymbol(decodedFrames);
  if (!symbol) return "";
  // "Other" is the form dropdown's catch-all. It reads as a platform in the
  // form and as nothing at all in a title, so it takes the empty fallback.
  const prefix = platform && platform !== "Other" ? platform : "Device";
  // Clamped here, not at the seed: the input's maxlength bounds typing but
  // not an assigned value, so an unclamped suggestion would show in full in
  // the field and arrive truncated on GitHub.
  return clampTitle(`${prefix}: ${reason || "crash"} in ${symbol}`);
}
