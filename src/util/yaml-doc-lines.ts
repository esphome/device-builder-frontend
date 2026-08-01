/**
 * Document-level line splitting and line-ending detection, dependency
 * free so consumers that must stay lightweight (the sensitive-value
 * scanner) can use it without pulling in the editor stack.
 */

/**
 * Split a document into lines with any trailing CR stripped. CRLF
 * documents must shed the CR before line classifiers run: JS regexes
 * treat CR as a line terminator, so patterns ending `(.*)$` cannot
 * match a line that kept one and every child key silently drops out
 * of the parse (#1601). Callers that rejoin restore the document's
 * ending via `yamlDocEol`.
 */
export function splitYamlDocLines(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  // A final segment with no terminating LF can still end in a bare CR
  // (a truncated CRLF write); the regex split only consumes CRs that
  // precede an LF.
  const last = lines.length - 1;
  if (lines[last].endsWith("\r")) lines[last] = lines[last].slice(0, -1);
  return lines;
}

/**
 * The document's line ending, by majority vote (ties go to LF). A
 * mixed-ending document normalizes toward its dominant ending, so one
 * pasted CRLF line in an LF file costs that line its CR on the next
 * save instead of converting the whole file.
 */
export function yamlDocEol(yaml: string): "\r\n" | "\n" {
  const crlf = yaml.split("\r\n").length - 1;
  const bareLf = yaml.split("\n").length - 1 - crlf;
  return crlf > bareLf ? "\r\n" : "\n";
}
