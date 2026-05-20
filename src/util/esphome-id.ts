/**
 * Normalize a user-typed identifier into a valid ESPHome id.
 *
 * ESPHome ids are Python-identifier-shaped: ``[a-zA-Z_][a-zA-Z0-9_]*``.
 * Anything outside that alphabet — spaces, slashes, dots, dashes,
 * diacritics, … — produces invalid YAML keys and breaks compilation.
 *
 * The frontend's add-script / add-api-action / script-editor / etc.
 * inputs run user input through this helper on every keystroke so
 * the value the user sees in the field IS the value that lands in
 * YAML. That keeps the rule self-documenting (the field reshapes as
 * the user types) and means we never have to surface a "your id is
 * invalid" error: the field can't hold an invalid id long enough to
 * be submitted.
 *
 * Rules:
 *
 * - Runs of disallowed characters collapse to a single underscore
 *   (``"my cool script"`` → ``"my_cool_script"``).
 * - Case is preserved — ESPHome accepts both, even though lowercase
 *   snake_case is conventional, and forcing case would surprise a
 *   user who deliberately typed ``MyScript``.
 * - Empty input stays empty (we let the caller's required-field
 *   check handle the empty case).
 *
 * Note that a normalized id can still start with a digit
 * (``"1abc"`` → ``"1abc"``), which is technically invalid as a YAML
 * key in ESPHome's grammar. That's a rare-enough case that we
 * leave it to the backend to reject on save rather than mutate
 * mid-type (prepending an underscore would make ``"1"`` → ``"_1"``
 * the moment the user starts typing, which is more disruptive
 * than helpful).
 */
export function normalizeEspHomeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_]+/g, "_");
}
