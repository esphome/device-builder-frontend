import { css } from "lit";

export const devicePageStyles = css`
  :host {
    display: block;
  }

  .page {
    box-sizing: border-box;
    padding: var(--wa-space-l) var(--wa-space-l) 0;
    min-height: calc(100vh - var(--esphome-header-height));
  }

  .layout-grid {
    display: grid;
    grid-template-columns: minmax(230px, 1fr) minmax(0, 5fr);
    gap: var(--wa-space-l);
    height: calc(
      100vh - var(--esphome-header-height) - var(--esphome-footer-height) - var(
          --wa-space-l
        )
    );
    transition: grid-template-columns 0.25s ease;
  }

  .layout-grid.nav-collapsed {
    grid-template-columns: minmax(0, 5fr);
  }

  .layout-grid.nav-collapsed .desktop-nav {
    display: none;
  }

  .drawer,
  .drawer-backdrop {
    display: none;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 80%);
    color: var(--esphome-on-primary);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--wa-border-radius-m);
    margin-right: var(--wa-space-xs);
  }

  .back-btn wa-icon {
    font-size: 14px;
  }

  .back-btn:hover {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%);
  }

  /* Sticky-bookmark expand affordance. Anchored to the left edge of
     the page wrapper (position: relative below), so it hugs the
     editor card and reads as a tab hanging off its side. Visible
     only when the navigator is hidden (desktop collapsed or mobile
     drawer closed) — the parent component gates rendering via the
     showEdgeTab flag, so we don't need a CSS hide branch. */
  .page {
    position: relative;
  }

  .nav-edge-tab {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Width spans the page's left padding minus a small inset, so
       the tab's right edge stops short of the editor card and the
       gap (--wa-space-2xs) reads as deliberate breathing room. */
    width: calc(var(--wa-space-l) - var(--wa-space-2xs));
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 0 var(--wa-border-radius-m) var(--wa-border-radius-m) 0;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    cursor: pointer;
    box-shadow: var(--wa-elevation-02);
    transition: background 0.12s;
  }

  .nav-edge-tab:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 8%);
  }

  .nav-edge-tab wa-icon {
    font-size: 18px;
  }

  @media (max-width: 900px) {
    .nav-edge-tab {
      /* Mobile page has no padding so the calc width collapses to a
         negative value — fall back to a fixed width that sticks the
         tab off the viewport's left edge over the editor. */
      width: 24px;
    }
  }

  @media (max-width: 900px) {
    /* Drop the page padding on mobile so the editor goes edge-to-edge.
       The card itself is already small at this width — wasting ~16px
       on each side to a frame just makes it harder to read; logs go
       full-screen the same way for the same reason.
       Each dvh line is paired with a vh fallback above it so
       pre-2022 browsers that don't recognise dvh still pick up the
       mobile sizing instead of dropping the declaration and falling
       through to the desktop rule (which had an extra
       2 * var(--wa-space-l) subtracted and would leave a gap). */
    .page {
      padding: 0;
      min-height: calc(
        100vh - var(--esphome-header-height) - var(--esphome-footer-height)
      );
      min-height: calc(
        100dvh - var(--esphome-header-height) - var(--esphome-footer-height)
      );
    }

    .layout-grid {
      grid-template-columns: 1fr;
      gap: 0;
      height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
      height: calc(100dvh - var(--esphome-header-height) - var(--esphome-footer-height));
    }

    .desktop-nav {
      display: none !important;
    }

    .drawer-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 99;
    }

    .drawer-backdrop--open {
      display: block;
    }

    .drawer {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 300px;
      max-width: 85vw;
      z-index: 100;
      background: var(--wa-color-surface-default);
      box-shadow: var(--wa-shadow-l);
      overflow-y: auto;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      --navigator-border-radius: 0;
      --navigator-border: none;
    }

    .drawer--open {
      transform: translateX(0);
    }
  }
`;
