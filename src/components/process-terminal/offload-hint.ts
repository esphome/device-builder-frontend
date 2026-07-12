import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { JobSource } from "../../api/types/firmware-jobs.js";
import { splitTemplate } from "../../util/template-split.js";

/**
 * Discovery hint shown in a running compile's ``suggestion`` slot once the
 * build has been going long enough to feel slow, pointing the user at the
 * "send builds to a faster machine" settings. Reuses the same
 * ``.reset-suggestion`` markup as the failure hints so each dialog's local
 * styling applies; the click handler is the host's, which opens Settings at
 * the build-offload section.
 */

/** Show the hint once a local compile passes this mark (ms). */
export const OFFLOAD_HINT_THRESHOLD_MS = 180_000;

export interface OffloadHintHost {
  _localize: LocalizeFunc;
  _tryOpenBuildOffloadSettings: () => void;
}

interface OffloadHintState {
  elapsedMs: number;
  source: JobSource;
  remoteBuildsEnabled: boolean | null;
  pairings: ReadonlyMap<string, unknown> | null;
}

/**
 * Gate the hint: a local compile past the threshold whose user hasn't
 * already set up offloading. A remote (or remote-pending) build, or a
 * dashboard with remote builds enabled or any pairing, suppresses it.
 * ``null`` context (still loading) counts as "not set up".
 */
export function shouldShowOffloadHint(state: OffloadHintState): boolean {
  if (state.source !== JobSource.LOCAL) return false;
  if (state.elapsedMs < OFFLOAD_HINT_THRESHOLD_MS) return false;
  if (state.remoteBuildsEnabled === true) return false;
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
