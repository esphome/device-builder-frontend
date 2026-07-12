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

// Arduino / CMake percent gauge: ``[ 17%]``.
const PIO_PERCENT = new RegExp(`^${ANSI}\\[\\s*\\d{1,3}\\s*%\\s*\\]`);

// Raw ninja per-target counter: ``[117/1247] Building C object …``. esp-idf's
// native build prints only these — no ``Compiling`` word. The tiny ``[1/2]
// Re-running CMake…`` reconfigure and the ~97-step bootloader sub-build are
// configuration, not the app compile, so require a large denominator (mirrors
// the backend's ``_NINJA_MIN_TOTAL``).
const NINJA_COUNTER = new RegExp(`^${ANSI}\\[\\s*\\d+\\s*/\\s*(\\d+)\\s*\\]`);
const NINJA_MIN_TOTAL = 100;

/** True once a streamed build line shows compilation has begun. */
export function isCompilePhaseLine(line: string): boolean {
  if (WORD_MARKERS.test(line) || PIO_PERCENT.test(line)) return true;
  const counter = NINJA_COUNTER.exec(line);
  return counter !== null && Number(counter[1]) >= NINJA_MIN_TOTAL;
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
