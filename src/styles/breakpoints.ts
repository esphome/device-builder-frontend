/**
 * Shared layout breakpoints (px).
 *
 * Single source of truth for the phone cutoff used across the UI: dialogs go
 * full-screen, the device table stacks into cards, dashboard gutters tighten,
 * and the component catalog caps its height. Defined here (rather than in any
 * one feature module) so every consumer can import it without coupling to an
 * unrelated component.
 */
export const MOBILE_BREAKPOINT = 600;
