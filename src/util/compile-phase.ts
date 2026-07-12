// Compile-phase detection over streamed build output. The clock the dashboard
// shows should count compilation only — not the Tool/Library Manager download
// or the CMake configure that precede it — so these match the first line that
// proves the toolchain is building and the line that closes it.

// A leading ANSI sequence is tolerated everywhere: PlatformIO colourises and
// repaints (``\x1b[2K`` etc.), so the escape isn't always a plain colour reset.
const ANSI = String.raw`(?:\x1b\[[0-9;]*[A-Za-z])*\s*`;

// Word-form build steps. ``Compiling <path>`` is emitted by PlatformIO for
// esp-idf, esp32-arduino, esp8266 and libretiny alike, so it's the universal
// trigger; the rest cover a cached build that jumps straight to linking. The
// trailing space anchors each so a stray token can't trip them. None appear in
// the download or configure phase (those lines start with ``--``, ``Tool
// Manager:``, ``Library Manager:``, ``Executing``, ``Running``, ``INFO``).
const WORD_MARKERS = new RegExp(
  `^${ANSI}(?:Compiling |Archiving |Linking |Indexing |Generating |Building in )`
);

// Arduino per-file gauge: ``[ 17%] Compiling …`` — percent *inside* the
// brackets. Distinct from the download ``Unpacking [----] 0%`` bar and the
// memory report ``RAM: [====] 37.7%`` (percent *outside*), and from esptool
// ``(45 %)`` / OTA ``Uploading … 35%`` — none of which mean "compiling", so a
// stray percentage during the download never trips it.
const PIO_PERCENT = new RegExp(`^${ANSI}\\[\\s*\\d{1,3}\\s*%\\s*\\]`);

// Raw ninja per-target counter: ``[117/1247] Building C object …``. esp-idf's
// native build prints only these — no ``Compiling`` word. The download always
// precedes ninja, so the first counter (even the tiny ``[1/2] Re-running
// CMake`` re-check) marks the build start; no total floor here. (The floor
// still applies to the *progress gauge* backend-side, a separate concern.)
const NINJA_COUNTER = new RegExp(`^${ANSI}\\[\\s*\\d+\\s*/\\s*\\d+\\s*\\]`);

/** True once a streamed build line shows compilation has begun. */
export function isCompilePhaseLine(line: string): boolean {
  return WORD_MARKERS.test(line) || PIO_PERCENT.test(line) || NINJA_COUNTER.test(line);
}

// PlatformIO closes each environment with a summary banner —
// ``========= [SUCCESS] Took 15.36 seconds =========`` (or ``[FAILED]``). For
// an install the flash phase streams after this, so freezing the compile clock
// here keeps the upload out of the count.
const COMPILE_END_LINE = /\[(?:SUCCESS|FAILED)\] Took /;

/** True once a streamed line shows the compile has finished (or failed). */
export function isCompileEndLine(line: string): boolean {
  return COMPILE_END_LINE.test(line);
}
