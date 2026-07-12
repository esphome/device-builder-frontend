import { stripAnsi } from "./ansi-escapes.js";

// Compile-phase detection over streamed build output. The clock the dashboard
// shows should count compilation only — not the Tool/Library Manager download
// that precedes it — so these match the first line that proves the toolchain is
// building and the line that closes it.
//
// Keep the marker set in sync with the backend's authoritative copy in
// esphome_device_builder/controllers/firmware/constants.py — the backend stamps
// compile_started_at/compile_ended_at from the same grammar; this mirror only
// drives the live (per-second) UX before those fields land over the stream.
//
// PlatformIO colourises and repaints its output, so escapes appear not only as
// a leading colour reset but *inside* tokens — the summary banner is literally
// ``[<green><bold>SUCCESS<reset>] Took`` — which would defeat an anchored match.
// Strip them first (shared helper, handles the literal ``\033`` form too), then
// match against the clean text.

// Word-form build steps. ``Compiling <path>`` is emitted by PlatformIO for
// esp32-arduino / esp8266 / libretiny and esp-idf-via-pio; ``Reading CMake
// configuration`` opens an esp-idf build (the real start, after the download);
// the rest cover a cached build that jumps straight to linking. The trailing
// space anchors the per-file ones so a stray token can't trip them. None appear
// in the download phase (``Tool Manager:`` / ``Library Manager:`` /
// ``Unpacking`` / ``Installing``).
const WORD_MARKERS =
  /^\s*(?:Compiling |Archiving |Linking |Indexing |Generating |Building in |Reading CMake configuration)/;

// Arduino per-file gauge: ``[ 17%] Compiling …`` — percent *inside* the
// brackets. Distinct from the download ``Unpacking [----] 0%`` bar and the
// memory report ``RAM: [====] 37.7%`` (percent *outside*), and from esptool
// ``(45 %)`` / OTA ``Uploading … 35%`` — none of which mean "compiling", so a
// stray percentage during the download never trips it.
const PIO_PERCENT = /^\s*\[\s*\d{1,3}\s*%\s*\]/;

// Raw ninja per-target counter: ``[117/1247] Building C object …``. esp-idf's
// native build prints only these — no ``Compiling`` word. The download always
// precedes ninja, so the first counter (even the tiny ``[1/2] Re-running
// CMake`` re-check) marks the build start; no total floor here. (The floor
// still applies to the *progress gauge* backend-side, a separate concern.)
const NINJA_COUNTER = /^\s*\[\s*\d+\s*\/\s*\d+\s*\]/;

/** True once a streamed build line shows compilation has begun. */
export function isCompilePhaseLine(line: string): boolean {
  const clean = stripAnsi(line);
  return WORD_MARKERS.test(clean) || PIO_PERCENT.test(clean) || NINJA_COUNTER.test(clean);
}

// PlatformIO closes each environment with a summary banner —
// ``========= [SUCCESS] Took 15.36 seconds =========`` (or ``[FAILED]``). For
// an install the flash phase streams after this, so freezing the compile clock
// here keeps the upload out of the count.
const COMPILE_END_LINE = /\[(?:SUCCESS|FAILED)\] Took /;

/** True once a streamed line shows the compile has finished (or failed). */
export function isCompileEndLine(line: string): boolean {
  // Runs per streamed line for the whole compile window; "Took " is plain
  // text in the banner (only the [SUCCESS]/[FAILED] token carries inline
  // ANSI), so this skips the strip + regex on essentially every other line.
  if (!line.includes("Took ")) return false;
  return COMPILE_END_LINE.test(stripAnsi(line));
}
