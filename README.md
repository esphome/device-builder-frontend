# ESPHome Device Builder Dashboard — Frontend

A web-based dashboard for managing, configuring, and deploying ESPHome IoT device firmware. Built with Lit web components and TypeScript.

> **This repository contains the frontend source only.** The dashboard runs as part of the **[ESPHome Device Builder Dashboard](https://github.com/esphome/device-builder)**, which ships a prebuilt copy of this frontend bundled in. End users should follow the install / run instructions in the backend repo — there's nothing to deploy from here on its own.

## Screenshots

Configured devices in the table view, with the discovered-devices banner above:

![Dashboard table view](docs/screenshots/dashboard-table.png)

Discovered devices expanded — each card surfaces the project metadata and offers a one-click "Take control" adoption flow:

![Discovered devices ready to adopt](docs/screenshots/dashboard-discovered.png)

Create-device wizard's board picker — searchable, filterable by chip family, with curated featured boards up front:

![Board picker in the create-device wizard](docs/screenshots/wizard-board-picker.png)

## Tech stack

- **[Lit](https://lit.dev/)** — Web components framework
- **TypeScript** — Strict mode throughout
- **[Rspack](https://rspack.dev/)** — Rust-based bundler
- **[Web Awesome](https://www.webawesome.com/)** — UI component library (Home Assistant variant)
- **[CodeMirror](https://codemirror.net/)** — YAML editor with syntax highlighting
- **[Sonner](https://sonner.emilkowal.dev/)** — Toast notifications

## Backlog

Before filing anything, take a look at the **[shared backlog](https://github.com/orgs/esphome/projects/7/views/1?filterQuery=project%3A%22device-builder-dashboard%22)** — it lists everything that's already planned, in progress, or shipped for the dashboard. Saves duplicates and gives you a feel for where the project is heading.

## Issues and feature requests

The new-issue chooser on this repo only surfaces redirect links — there's no way to file a generic issue here.

- **🐛 Bugs** → [backend issue tracker](https://github.com/esphome/device-builder/issues). UI bugs go there too so we can triage everything in one place.
- **💡 Feature ideas** → [ESPHome org discussions](https://github.com/orgs/esphome/discussions) or the [dashboard Discord channel](https://discord.gg/Rf2jWGVjaK) where the new UI is actively discussed and feedback is being collected. Once a request is shaped enough to be actionable a maintainer adds it to the backlog above.

## Contributing — local development

The rest of this README is for developers working on the frontend itself. If you just want to run the dashboard, head over to the [backend repo](https://github.com/esphome/device-builder) and follow its setup.

### Prerequisites

- Node.js 22+ (with npm)
- A running ESPHome Device builder backend on `localhost:6052` — clone and run [device-builder](https://github.com/esphome/device-builder) in dev mode in a separate terminal

### Install

```bash
npm install
```

### Dev server

```bash
npm run dev
```

Starts an HMR dev server at `http://localhost:5173`. WebSocket and REST traffic are proxied to the backend at `localhost:6052`.

### Production build

```bash
npm run build
```

Outputs the bundled assets into `esphome_device_builder_frontend/` — that directory doubles as the Python package source for the wheel that ships with the backend release. The `__init__.py` exposing the asset path is sourced from `public/__init__.py` and copied into place by the bundler.

To produce the wheel locally (matches what CI builds on release):

```bash
npm run build
python3 -m build --wheel
# wheel ends up in dist/
```

### Other scripts

| Script               | Description                            |
| -------------------- | -------------------------------------- |
| `npm run lint`       | TypeScript type-check (`tsc --noEmit`) |
| `npm test`           | Run the Vitest suite once              |
| `npm run test:watch` | Run tests in watch mode                |
| `npm run format`     | Format `src/` with Prettier            |

## Project structure

```
src/
├── api/            # WebSocket/HTTP API client and types
├── components/     # Lit web components
│   ├── device/     # Device editor, navigator, component catalog
│   └── wizard/     # Device creation wizard steps
├── pages/          # Routed page components (dashboard, device, secrets)
├── context/        # Lit Context definitions
├── common/         # i18n / localization
├── util/           # Helpers (debounce, YAML parsing, icons, ...)
├── styles/         # Theme and shared styles
├── translations/   # Language files (en, fr, nl)
└── entrypoint.ts   # App bootstrap

public/
├── __init__.py     # Python package entry — copied into the build
│                   # output at bundle time so the wheel exposes a
│                   # `where()` helper pointing at the static assets.
├── index.html      # HTML shell
└── static/         # Static assets (favicons, ...)

esphome_device_builder_frontend/   # Build output (gitignored)
```

## Code structure policies

These rules apply to all new code in `src/`. Existing files that pre-date them are grandfathered, but please don't make them worse.

### File size

- **Hard limit: 500–600 lines per file.** Split before a file grows past this.
- No exceptions for "it's just one big component". Break it up.

### Component decomposition

- Prefer many small, focused components over one large one.
- If a `render()` method exceeds ~100 lines, that's a signal to extract a sub-component.
- Extract repeated template patterns into their own components immediately — don't wait for the third copy.

### Folder structure

- One `@customElement` per `.ts` file. File name matches element name: `esphome-foo-bar.ts` → `<esphome-foo-bar>`.
- If a feature grows beyond 2–3 files, give it its own subfolder (see `src/components/settings-dialog/` for the pattern).
- Create folders proactively when grouping related files makes sense — don't pile everything flat.

### TypeScript

- `strict: true` everywhere. No implicit `any`, no non-null assertions without a clear reason.
- New code uses `unknown` and narrows; avoid `any`.

### What to avoid

- No `document.querySelector` — go through shadow DOM.
- No direct DOM mutation — use reactive properties and re-render.
- No business logic in `render()` — extract to private methods or computed properties.
- No new global singletons for state two components need — use Lit context.

### Localization

- All user-facing strings go through `_localize(key)` from `src/common/localize.ts`.
- New keys added to `en.json` must land in `fr.json` and `nl.json` in the same PR — the i18n machinery falls back to English silently, which mixes languages in non-English UIs.

### Comments

- Default comments. Add one only when the _why_ is non-obvious (a constraint, an invariant, a workaround). Don't restate what the code does.

## Releases

Releases are produced by GitHub Actions:

- `release.yml` — manual trigger (or called from `auto-release.yml`). Tags the version, drafts release notes from PR labels, builds the Python wheel, attaches it to the GitHub release, then opens or updates a single bump PR on the backend repo so it can pick up the new wheel URL.
- `auto-release.yml` — nightly cron that auto-releases when ≥ 2 commits have landed since the last release.
- `dependabot.yml` + `auto-approve-dependabot.yml` — weekly npm + Actions bumps with auto-approve.

The backend's `pyproject.toml` references the wheel by GitHub release URL (no PyPI), so a release here is everything needed to ship a new dashboard build.

## Status

### Disabled features

The frontend is wired up for some features the backend doesn't expose yet. Anything in this list is gated behind a flag in [`src/feature-flags.ts`](src/feature-flags.ts) — flip the flag to re-enable once the backend lands.

- **Automations** (`AUTOMATIONS_ENABLED`) — the navigator's "Automations" group is still visible and lists existing automations parsed from the YAML, but the "+ Add automation" action button is greyed out (and the underlying dialog isn't mounted). The ESPHome WebSocket API doesn't yet expose the endpoints the UI needs to add new ones (catalog of triggers / conditions / actions, schema lookups, save-back hooks). Re-enable by setting `AUTOMATIONS_ENABLED = true` once those land.

## License

Apache 2.0
