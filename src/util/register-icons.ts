/**
 * Registers a custom "mdi" icon library for wa-icon components
 * that resolves MDI icon names to inline SVG data URIs.
 *
 * Usage:
 *   import { registerMdiIcons } from "./register-icons.js";
 *   registerMdiIcons({ home: mdiHome, devices: mdiDevices });
 *
 * Then in templates:
 *   <wa-icon library="mdi" name="home"></wa-icon>
 */
import { registerIconLibrary } from "@home-assistant/webawesome/dist/components/icon/library.js";

const iconMap = new Map<string, string>();

let registered = false;

/**
 * Register MDI icons for use with `<wa-icon library="mdi" name="...">`.
 * Can be called multiple times to add more icons.
 */
export function registerMdiIcons(icons: Record<string, string>): void {
  for (const [name, path] of Object.entries(icons)) {
    iconMap.set(name, path);
  }

  if (!registered) {
    registered = true;
    registerIconLibrary("mdi", {
      resolver: (name: string) => {
        const pathData = iconMap.get(name);
        if (!pathData) {
          console.warn(`[mdi] Unknown icon: ${name}`);
          return "";
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="${pathData}"/></svg>`;
        return `data:image/svg+xml,${encodeURIComponent(svg)}`;
      },
    });
  }
}

/**
 * Helper to create an inline SVG data URI from an MDI path string.
 * Use this when you need to set the `src` property directly on wa-icon
 * without going through the library system.
 */
export function mdiIconSrc(pathData: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="${pathData}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
