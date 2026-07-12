// PlatformIO / ninja compile-phase markers. These lines only appear once the
// toolchain starts building — never during the Tool/Library Manager dependency
// download that precedes it — so the first match marks where the compile clock
// should start (excluding download time). Covers the per-file steps that every
// build emits (``Compiling``/``Archiving``/``Linking``/``Indexing``), the
// PlatformIO "Building in <mode> mode" banner, and the bracketed progress forms
// (Arduino ``[ 17%]``, ninja ``[907/1424]``). A leading ANSI colour reset is
// tolerated since PlatformIO colourises output.
const COMPILE_PHASE_LINE =
  /^(?:\x1b\[[0-9;]*m)*\s*(?:Compiling|Archiving|Linking|Indexing|Building in |\[\s*\d)/;

/** True once a streamed build line shows compilation has begun. */
export function isCompilePhaseLine(line: string): boolean {
  return COMPILE_PHASE_LINE.test(line);
}
