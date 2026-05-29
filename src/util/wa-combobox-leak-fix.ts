/**
 * Work around a webawesome 3.7.0 memory leak.
 *
 * ``wa-option``'s ``handleDefaultSlotChange`` runs on every slot change
 * and calls ``customElements.whenDefined("wa-combobox").then(cb)``, where
 * ``cb`` closes over the option element. No 3.7.0 build ships
 * ``wa-combobox``, so that promise never resolves; the registry keeps the
 * reaction (and its captured option) alive forever. Every form mount that
 * renders a ``wa-select`` then leaks the option -> select -> form ->
 * editor subtree, so repeatedly opening section editors grows memory
 * without bound (#1031).
 *
 * Registering a stub resolves the promise so the pending reactions settle
 * and release. ``cb`` does ``this.closest("wa-combobox")`` -> null (we
 * never nest options under a real combobox), so it is a no-op.
 */
export function installWaComboboxLeakFix(): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get("wa-combobox")) return;
  customElements.define("wa-combobox", class extends HTMLElement {});
}
