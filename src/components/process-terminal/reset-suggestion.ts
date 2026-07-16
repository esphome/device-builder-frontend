import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { splitTemplate } from "../../util/template-split.js";
import {
  type RemoteBuildHintHost,
  renderRemoteBuildFailureSuggestion,
} from "../remote-build-hint.js";

/**
 * Build / validation failure hints, shared by the command-dialog and
 * firmware-install-dialog drivers. The markup (``.reset-suggestion`` +
 * ``.reset-suggestion-link``) used to be copy-pasted in both
 * ``renderers.ts`` files; the *container* styling still differs per dialog
 * (stream terminal palette vs centered card), so each driver styles those
 * classes — only the markup + click wiring is unified here.
 *
 * Each driver keeps its own ``renderResetSuggestion`` gate (which failure
 * phase, user-stopped, local-vs-remote label resolution) and delegates the
 * actual markup to these functions, so the existing renderer-walking tests
 * that call the driver gate stay valid.
 */
export interface SuggestionHost extends RemoteBuildHintHost {
  _localize: LocalizeFunc;
  _tryOpenInEditor: () => void;
  _tryCleanBuild: () => void;
  _tryResetBuildEnv: () => void;
}

/** YAML validation failed → "open in editor". */
export function renderValidationFailureSuggestion(host: SuggestionHost): TemplateResult {
  const text = host._localize("command.validation_failed_suggestion");
  const [before, after] = splitTemplate(text, "{editor_action}");
  return html`
    <div class="reset-suggestion" role="status" slot="suggestion">
      ${before}<button class="reset-suggestion-link" @click=${host._tryOpenInEditor}>
        ${host._localize("command.try_open_editor_button")}</button
      >${after}
    </div>
  `;
}

/**
 * C++ build failure. ``remoteLabel`` non-null → the build ran on a paired
 * receiver, so the local reset link is useless: delegate to the remote hint
 * (a direct remote-reset offer when ``resetPin`` is non-null, else the
 * "ask the operator of <receiver>" fallback). Null → the local
 * clean → reset staircase.
 */
export function renderBuildFailureSuggestion(
  host: SuggestionHost,
  remoteLabel: string | null,
  resetPin: string | null = null
): TemplateResult {
  if (remoteLabel !== null) {
    return renderRemoteBuildFailureSuggestion(host, remoteLabel, resetPin);
  }
  const text = host._localize("command.try_reset_suggestion");
  const [before, middle, after] = splitTemplate(text, "{clean_action}", "{reset_action}");
  return html`
    <div class="reset-suggestion" role="status" slot="suggestion">
      ${before}<button class="reset-suggestion-link" @click=${host._tryCleanBuild}>
        ${host._localize("command.try_clean_button")}</button
      >${middle}<button class="reset-suggestion-link" @click=${host._tryResetBuildEnv}>
        ${host._localize("command.try_reset_button")}</button
      >${after}
    </div>
  `;
}
