import { withBase } from "./base-path.js";

export type LeaveGuard = () => Promise<boolean>;

let activeGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  activeGuard = guard;
}

export async function navigate(url: string): Promise<void> {
  if (activeGuard) {
    const canLeave = await activeGuard();
    if (!canLeave) return;
  }
  window.history.pushState({}, "", withBase(url));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
