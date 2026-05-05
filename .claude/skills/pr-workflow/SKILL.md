---
name: pr-workflow
description: Create pull requests for esphome/device-builder-frontend. Use when creating PRs, submitting changes, or preparing contributions.
allowed-tools: Read, Bash, Glob, Grep
---

# device-builder-frontend PR Workflow

When creating a pull request for `esphome/device-builder-frontend`,
follow these steps. The frontend ships prebuilt inside the
`esphome/device-builder` Python wheel, so backend-visible changes
(WS commands, model shapes, `ConfigEntryType` values) usually need
a coordinated PR there too.

## 1. Create branch from origin/main

`origin` already points at `esphome/device-builder-frontend` —
there is no fork in this workflow. Always re-fetch first:

```bash
git fetch origin
git checkout -b <branch-name> origin/main
```

## 2. Read the PR template

Before creating a PR, read `.github/PULL_REQUEST_TEMPLATE.md` for
the required sections. Fill in **every** section — do not skip or
abbreviate. If the template's "Types of changes" list looks
narrower than the label set the workflow enforces (see step 3),
prefer the workflow's canonical list when picking a label.

## 3. Apply a release-notes label

`.github/workflows/pr-labels.yaml` uses
`ludeeus/action-require-labels` to require **at least one** of the
release-drafter labels — it does not cap the number, but
release-drafter slots a PR by its first matching label, so in
practice apply just one:

`breaking-change`, `bugfix`, `refactor`, `new-feature`,
`enhancement`, `maintenance`, `ci`, `dependencies`, `docs`.

Unlike the backend repo, this workflow does **not** auto-apply a
label from a checkbox — you must pass the label explicitly when
creating the PR (or apply it via the UI before CI runs):

```bash
gh pr create --label enhancement ...
```

Pick whichever label release-drafter would file the change under;
if in doubt, look at the headings in `.github/release-drafter.yml`.

## 4. Backend coordination

If the change consumes a new WS command, event, model field, or
`ConfigEntryType` from `esphome/device-builder`, link the companion
backend PR in the description. Frontend PRs that depend on
unmerged backend changes should stay in draft until the backend
side has landed.

## 5. Commit message conventions

- **Imperative-mood subject line** — "Add X", not "Added X".
- **No `Co-Authored-By: Claude` trailer.** Project preference
  (matches the backend repo).
- One logical change per commit. Run `npm run lint` and
  `npm run test` locally before pushing.

## 6. Push and create the PR

**Always read `.github/PULL_REQUEST_TEMPLATE.md` from the repo at
PR-creation time and use it verbatim as the body** — do not
reproduce, paraphrase, or trim the template anywhere else, or it
will silently drift out of sync as the template evolves.

When filling in the template:

- Replace the `<!-- ... -->` prompt comments with the actual prose
  for that section. Do not delete anything else.
- **Leave all the checkboxes in place.** Do not remove rows you
  aren't ticking — the human reviewer relies on the full list
  being present.
- Tick exactly one "Types of changes" box. For the Checklist
  section, only tick boxes you have actually verified; leave the
  rest as `- [ ]`.
- **Do not escape characters from the template.** Backticks,
  asterisks, angle brackets, etc. must be passed through verbatim
  — escaping a backtick to `` \` `` corrupts inline code in the
  rendered PR. The template is already valid Markdown; do not
  rewrite it for shell quoting. Use `--body-file`, never
  `--body "..."` with shell-escaping.

```bash
git push -u origin <branch-name>
# Read .github/PULL_REQUEST_TEMPLATE.md, fill it in as above,
# write the result to a temp file, then:
gh pr create --repo esphome/device-builder-frontend --base main \
  --label <release-notes-label> \
  --title "Imperative subject under 70 chars" \
  --body-file /tmp/pr-body.md
```

## 7. After the PR is open

CI runs the test workflow and the label-verifier. If `pr-labels`
fails, the PR is missing one of the canonical release-drafter
labels — apply one via `gh pr edit --add-label <label>` rather
than pushing an empty commit.
