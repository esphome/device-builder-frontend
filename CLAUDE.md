# Notes for Claude

A short orientation file for an LLM working in this repo. Skim
before making changes; keep edits to existing code consistent
with what's described here.

**Before writing code, read [README.md → "Code structure
policies"](README.md#code-structure-policies).** Those rules
(500-600 line file cap, component decomposition, folder layout,
TypeScript / DOM / localization / comment policies) are the
authoritative coding standard for this repo, set and maintained
by the human maintainers; everything in this CLAUDE.md sits on
top of them. When a rule in README.md and a rule here disagree,
README.md wins; flag the conflict in the PR so this file can be
brought back into line.

## What this project is

The **frontend** for the ESPHome Device Builder dashboard, a Lit
and TypeScript SPA that ships **prebuilt and bundled** inside the
backend wheel ([esphome/device-builder](https://github.com/esphome/device-builder)).
End users never install this directly. A release of the frontend
generates a versioned tarball that the backend's release workflow
picks up; that's the only deployment path.

## Frontend-backend deployment is **lockstep, not a wire contract**

This is the load-bearing fact that shapes most of the rules below.
The frontend in this repo and the backend that runs it always
ship together; a given backend version pins a specific frontend
version via the wheel's bundled assets. There is no installation
in the wild that runs frontend N with backend N±1.

Practical consequences:

- **Don't write backwards-compatibility shims for the backend.**
  No `instanceof APIError && err.errorCode === "unknown_command"`
  fallbacks for "an older backend that doesn't know this WS
  command yet". The backend ALWAYS knows every command this
  frontend issues, because it's the backend that bundled this
  frontend. A failure on a known command is a real bug, not a
  version drift.
- **Don't probe for feature support before using a feature.** If
  the backend just landed `remote_build/list_hosts`, the frontend
  PR that consumes it lands at the same time. There's no
  "feature flag" or "is this command available" check. Either
  the frontend uses it or it doesn't ship yet.
- **Backend WS-command renames / shape changes are coordinated
  PRs.** Always link the companion backend PR in the frontend
  PR's description. CI doesn't enforce the link but a reviewer
  will catch a frontend PR that consumes a command nobody added
  on the backend side.
- **Old translation keys**: when removing a `_localize("foo")`
  call site, also delete the key from `src/translations/*.json`.
  No legacy keys retained "in case some downstream uses them":
  there is no downstream.

A real failure path (WS dropped, server bug, validation rejection)
still warrants a `try/catch` with revert + toast for
security-sensitive controls. The rule is "don't write code that
exists only to handle a version skew that can't happen", not
"never catch errors".

## What this means at PR-review time

If a reviewer leaves a comment suggesting a defensive branch for
"older backend without command X" or "fallback for older client",
push back: that case can't happen in this deployment shape.
Linking this CLAUDE.md inline (e.g. "see CLAUDE.md §
Frontend-backend deployment is lockstep") is the canonical reply.

## Code style

See [README.md → "Code structure
policies"](README.md#code-structure-policies) first; the file
size, component-decomposition, folder layout, and DOM / a11y
rules there are authoritative. The bullets below are practical
expansions, not substitutes. The high-leverage ones to keep in
working memory while editing:

- **File size cap: 500-600 lines.** Split before crossing it; no
  exemptions for "it's just one big component." If a render
  block exceeds ~100 lines, that's the signal to extract a
  sub-component.
- **One `@customElement` per file.** File name matches element
  name (`esphome-foo-bar.ts` → `<esphome-foo-bar>`). When a
  feature grows beyond ~3 files, give it its own subfolder
  (`src/components/settings-dialog/` is the pattern).
- **No `document.querySelector`, no direct DOM mutation.** Go
  through shadow DOM via `@query` / refs, and use reactive
  properties to re-render. No business logic in `render()`;
  extract it to private methods or computed values.
- **TypeScript strict** throughout. No `any` in new code; use
  `unknown` and narrow when truly necessary. Existing `as never`
  casts are legacy and shouldn't be cargoed.
- **Lit components** use `@customElement("esphome-foo-bar")` and
  decorators (`@state`, `@property`, `@query`, `@consume`,
  `@provide`). Mirror the existing patterns rather than
  introducing new ones.
- **Context for cross-component state.** When two unrelated
  components both need a value (theme, locale, the labels
  catalog, the API instance, ...), provide it via Lit context
  from `app-shell` and consume it where it's needed. Avoid prop
  drilling and avoid a global singleton; the context-based
  pattern is what lets `app-shell` own the WS lifecycle and
  every consumer pick up reconnect events for free.
- **Styles** live in `src/styles/shared.ts` (`espHomeStyles`)
  for cross-component utilities; component-local rules go in
  the component's own `static styles = [espHomeStyles, css\`…\`]`
  array.
- **Toasts** via `sonner-js`: `toast.error`, `toast.info`,
  `toast.success`. Use `richColors: true` for any toast a user
  needs to actually read. See `app-shell.ts` for the
  configuration call.

## Settings dialog conventions

The Settings dialog (`src/components/settings-dialog.ts`) uses a
sidebar navigation pattern. New sections add an entry to the
`SECTIONS` array (id + icon + labelKey), a `_renderXxx()` method,
and a case in `_renderSection()`'s switch.

State for a setting flows through context:

1. `app-shell` declares the context provider + state field +
   handler (`_onSet<Field>`).
2. The Settings dialog `@consume`s the context and dispatches a
   bubbling `CustomEvent("set-<field>", { detail })` from the
   toggle / select.
3. `app-shell` listens for that event in the dialog binding,
   updates its state, persists to the backend, reverts +
   surfaces a toast on failure.

For security-sensitive toggles (e.g. anything that grants a peer
permissions on this dashboard), the optimistic-update path MUST
revert + toast on backend failure. Silent UI/disk divergence is
a real bug on those controls. Capture the previous value before
the optimistic flip, await the API call inside `try/catch`, and
on failure assign the previous value back and surface a
`toast.error`.

## ARIA / a11y

- `<button class="toggle" role="switch">` toggles need
  `aria-labelledby` pointing at the row's title `<span>` (give
  it an id). An empty `<button>` with no accessible name reads
  as "switch, checked" with no context to a screen-reader user.
- `aria-checked` is the **string-attribute** form (`aria-checked=${value}`),
  not Lit's `?aria-checked=${value}` boolean binding. Boolean
  bindings omit the attribute on `false`, breaking both the
  `[aria-checked="false"]` CSS state and the screen-reader
  announcement.
- Empty-state rows (placeholder copy where a control would
  normally go) get `role="status"` so they read as
  announcements, not as broken settings rows.

## Localization

- `src/translations/en.json` is the source-of-truth English copy.
  Other locales (`fr.json`, `nl.json`, ...) overlay on top with
  English fallback for missing keys.
- **Add new keys to every translation file at the same time.**
  When you add a key to `en.json`, add a real translation to
  `fr.json` and `nl.json` in the same PR. The library falls back
  to English when a key is missing, which means a partially-
  translated UI silently mixes English strings into French / Dutch
  pages, which is worse than just shipping a less-polished
  translation. Native speakers can refine later, but having the
  keys in place is the load-bearing concern. Don't ship a PR that
  adds an English key without the matching translations.
- Don't write English copy verbatim into `fr.json` as a
  placeholder; do an actual translation, even if it's
  approximate. The fallback machinery already handles missing
  keys; an English string copied into `fr.json` reads to a French
  user as "this dashboard claims to be French but isn't,"
  which is worse than the missing-key fallback.
- Use the `_localize(key)` pattern from
  `src/common/localize.ts` consumed via `localizeContext`. Don't
  hardcode user-facing strings.

## Commit / PR conventions

- **Don't self-merge frontend PRs.** The frontend codebase
  carries a high volume of AI-assisted contributions and the
  maintainers (Steven, Marcel) are actively curating quality
  and consistency. Push PRs, hand them off for human review,
  and let a maintainer merge; don't `gh pr merge` your own
  work on this repo even when CI is green and Copilot is
  satisfied. The CLAUDE-side review pass and the human
  curation pass catch different things; both are required.
- **No `Co-Authored-By: Claude` trailer.** Project preference.
- Imperative-mood subject line ("Add X", not "Added X").
- Tick exactly one "Types of changes" box in the PR body. CI
  derives the label from it. The full template is in
  `.github/PULL_REQUEST_TEMPLATE.md`; the `pr-workflow` skill
  walks through filling it in.
- Always link the companion backend PR if there is one. Backend
  WS commands / model shape changes need coordinated PRs.

## Things that have bitten us before

- **Optimistic update without revert-on-failure.** A
  `setSettings({...}).catch(() => {})` fire-and-forget leaves
  the UI showing the new value while the backend kept the old
  one. For security-sensitive toggles, the user has no idea
  their click didn't take effect. Always revert + toast.
- **Reconnect race vs in-flight write.** `app-shell` re-fetches
  state on every (re)connect; if a user-initiated write is racing
  with the reconnect, the reload can clobber the optimistic value
  with the pre-write server snapshot. Gate the reload path with
  an instance-level "in-flight" boolean that the optimistic-update
  handler sets before the API call and clears in `finally`, so
  the post-reconnect `_load*` short-circuits while a write is
  outstanding.
- **`?aria-checked=` boolean binding.** A drive-by "fix" that
  switches the string-attribute form to Lit's boolean binding
  silently breaks the toggle's CSS and a11y on `false`. Comment
  near each toggle explains why the form is what it is.
- **Localization keys getting orphaned.** Removing a
  `_localize("foo")` call site without removing the key from
  `en.json` leaves dead translations that have to be cleaned up
  later. Delete keys at the same time you remove the call.
- **Skipping `fr.json` / `nl.json` when adding new keys.** If a
  PR adds a key to `en.json` but not the other locale files, the
  fallback machinery silently shows the English string to
  French / Dutch users. The polished-but-mixed-language UI is
  worse than a slightly-rough but consistently-localized one.
  Always add real translations to every locale file when adding
  new copy.

## Useful entry points

| Path | What |
|---|---|
| `src/components/app-shell.ts` | Top-level component owning WS lifecycle, contexts, and most cross-component state |
| `src/components/settings-dialog.ts` | Settings page; sidebar pattern, one section per `_renderXxx()` method |
| `src/api/esphome-api.ts` | WS client; typed wrappers for backend commands |
| `src/api/types.ts` | All WS request/response types organized by domain |
| `src/context/contexts.ts` | Lit context definitions (provided by `app-shell`, consumed everywhere) |
| `src/translations/en.json` | English source-of-truth copy |
| `test/api/esphome-api.test.ts` | Typed-wrapper tests; canonical pattern for new API methods |

## Things not to do

- **Don't add backwards-compatibility shims for older backends**
  (see top of file).
- **Don't add `Co-Authored-By: Claude` to commits.**
- **Don't probe for feature support** before using a backend
  command.
- **Don't ship a PR that adds new keys to `en.json` without
  matching real translations in `fr.json` and `nl.json`.** The
  fallback machinery hides the gap by silently rendering English
  in the non-English UI; the result reads worse to a non-English
  user than a slightly-rough translation would.
- **Don't write English placeholders into non-English locale
  files** as a workaround. The fallback already does that
  silently; an explicit English string in `fr.json` is just an
  unflagged shipping bug.
- **Don't introduce new global singletons** for state that two
  components both need; use Lit context.
- **Don't reorder existing public Lit element APIs** (props,
  events, slots) without a reason. They're the de-facto contract
  with `app-shell` and other consumers.
