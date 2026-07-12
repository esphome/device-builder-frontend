import { html, type TemplateResult } from "lit";
import { JobSource } from "../../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { splitTemplate } from "../../util/template-split.js";

/**
 * Discovery hint shown in a running compile's ``suggestion`` slot once the
 * build has been going long enough to feel slow, pointing the user at the
 * "send builds to a faster machine" settings. Reuses the same
 * ``.reset-suggestion`` markup as the failure hints so each dialog's local
 * styling applies; the click handler is the host's, which opens Settings at
 * the build-offload section.
 */

/** Show the hint once a local compile passes this mark (ms). Five minutes:
 *  heavy-but-normal builds (voice satellites, BT proxy) take 3+ minutes even
 *  on fast hardware and shouldn't trip it. */
export const OFFLOAD_HINT_THRESHOLD_MS = 5 * 60 * 1000;

export interface OffloadHintHost {
  _localize: LocalizeFunc;
  _tryOpenBuildOffloadSettings: () => void;
}

interface OffloadHintState {
  elapsedMs: number;
  source: JobSource;
  pairings: ReadonlyMap<string, unknown> | null;
}

/**
 * Gate the hint: a local compile past the threshold on a dashboard with no
 * build server paired. A remote (or remote-pending) build, or any pairing,
 * suppresses it. The "auto-route to remote build" toggle is *not* consulted —
 * it defaults on, so gating on it would hide this nudge from every default
 * dashboard; only an actual pairing means offload is set up. ``null`` pairings
 * (still loading) counts as "not set up".
 */
export function shouldShowOffloadHint(state: OffloadHintState): boolean {
  if (state.source !== JobSource.LOCAL) return false;
  if (state.elapsedMs < OFFLOAD_HINT_THRESHOLD_MS) return false;
  if ((state.pairings?.size ?? 0) > 0) return false;
  return true;
}

export function renderOffloadHint(host: OffloadHintHost): TemplateResult {
  const text = host._localize("command.offload_hint");
  const [before, after] = splitTemplate(text, "{action}");
  return html`
    <div class="reset-suggestion" role="status" slot="suggestion">
      ${before}<button
        class="reset-suggestion-link"
        @click=${host._tryOpenBuildOffloadSettings}
      >
        ${host._localize("command.offload_hint_action")}</button
      >${after}
    </div>
  `;
}
