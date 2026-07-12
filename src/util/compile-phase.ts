// Compile-phase markers, shared by every toolchain the dashboard builds:
// ``Compiling <path>`` is emitted by esp-idf (ninja) and by PlatformIO for
// esp32-arduino / esp8266 / libretiny alike, so it's the universal trigger.
// The rest (``Archiving``/``Linking``/``Indexing``/``Generating`` steps, the
// PlatformIO "Building in <mode> mode" banner, and the bracketed progress
// forms — Arduino ``[ 17%]``, ninja ``[907/1424]``) are fallbacks for a
// fully-cached build that skips straight to linking. None of these appear
// during the Tool/Library Manager dependency download, so the first match
// marks where the compile clock starts (download excluded). The trailing
// space anchors the word markers so a stray token can't trip them; a leading
// ANSI sequence is tolerated since PlatformIO colourises and repaints output.
const COMPILE_PHASE_LINE =
  /^(?:\x1b\[[0-9;]*[A-Za-z])*\s*(?:Compiling |Archiving |Linking |Indexing |Generating |Building in |\[\s*\d)/;

/** True once a streamed build line shows compilation has begun. */
export function isCompilePhaseLine(line: string): boolean {
  return COMPILE_PHASE_LINE.test(line);
}
