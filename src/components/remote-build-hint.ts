import { css, html, type TemplateResult } from "lit";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import { splitTemplate } from "../util/template-split.js";

/**
 * Whether the remote build-env reset can be offered for a pairing: it's an
 * approved, connected build server that advertised the capability. Single
 * home for the rule the pairing row and both failure-hint renderers gate on.
 */
export function canResetBuildEnv(pairing: PairingSummary): boolean {
  return (
    pairing.status === "approved" &&
    pairing.connected &&
    pairing.reset_build_env_supported
  );
}

/** Route *pin*'s confirm-then-follow remote reset to the firmware-jobs dialog. */
export function requestResetPeerBuildEnv(el: HTMLElement, pin: string): void {
  el.dispatchEvent(
    new CustomEvent("open-reset-peer-build-env", {
      detail: { pin_sha256: pin },
      bubbles: true,
      composed: true,
    })
  );
}

// Visual boundary around the user-controlled receiver label inlined in the
// remote-build hint — keeps a hostile pairing label from blending into the
// system-tone copy and crafting coherent-sounding instructions. Shared by
// command-dialog and firmware-install-dialog so the wrapper styling stays
// in lockstep with the renderer it pairs with.
export const remoteBuildHintStyles = css`
  .receiver-label {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--term-bg);
    border: 1px solid var(--term-border);
    color: var(--term-fg);
    font-family: inherit;
    font-size: inherit;
  }
`;

// Hosts that can render the remote-build-failure hint. Both
// command-dialog and firmware-install-dialog satisfy this — the shared
// renderer used to live duplicated in each component's renderers.ts.
export interface RemoteBuildHintHost {
  _localize: LocalizeFunc;
  _tryCleanBuild: () => void;
  _tryResetRemoteBuildEnv: (pin: string) => void;
}

// Build-failure hint shown when the failed compile ran on a paired
// receiver. firmware/reset_build_env wipes the LOCAL toolchain cache, so
// the link half is useless when the broken cache is on the receiver.
// A non-null `resetPin` (capable + connected pairing) offers the remote
// reset directly; otherwise the "ask the operator of <receiver>"
// fallback stays for old receivers.
//
// The receiver label is user-controlled (set during pairing on another
// machine). Wrapping it in a styled <code> gives a visual boundary so a
// hostile pairing label can't blend into the system-tone hint and craft
// coherent-sounding instructions for the local user. Lit text
// interpolation already escapes HTML in {receiver}; the <code> wrapper
// is a presentational guard, not an XSS defense.
export function renderRemoteBuildFailureSuggestion(
  host: RemoteBuildHintHost,
  receiver: string,
  resetPin: string | null = null
): TemplateResult {
  if (resetPin !== null) {
    const template = host._localize("command.try_reset_suggestion_remote_capable");
    const [before, middle, after] = splitTemplate(
      template,
      "{clean_action}",
      "{reset_remote_action}"
    );
    return html`
      <div class="reset-suggestion" role="status" slot="suggestion">
        ${before}<button class="reset-suggestion-link" @click=${host._tryCleanBuild}>
          ${host._localize("command.try_clean_button")}</button
        >${middle}<button
          class="reset-suggestion-link"
          @click=${() => host._tryResetRemoteBuildEnv(resetPin)}
        >
          ${host._localize("command.try_reset_remote_button")}</button
        >${after}
      </div>
    `;
  }
  const template = host._localize("command.try_reset_suggestion_remote");
  const [before, middle, after] = splitTemplate(template, "{clean_action}", "{receiver}");
  return html`
    <div class="reset-suggestion" role="status" slot="suggestion">
      ${before}<button class="reset-suggestion-link" @click=${host._tryCleanBuild}>
        ${host._localize("command.try_clean_button")}</button
      >${middle}<code class="receiver-label">${receiver}</code>${after}
    </div>
  `;
}
