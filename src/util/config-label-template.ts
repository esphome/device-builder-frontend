import { html, nothing, type TemplateResult } from "lit";
import { fileNameOf, folderOf } from "./file-paths.js";

/** A configuration's file name, followed for a nested device by its folder
 *  in a ``config-folder`` span (styled muted by the host), so two devices
 *  sharing a file name in different folders stay apart. */
export function renderConfigLabel(configuration: string): TemplateResult {
  const folder = folderOf(configuration);
  return html`${fileNameOf(configuration)}${
    folder ? html` <span class="config-folder">${folder}</span>` : nothing
  }`;
}
