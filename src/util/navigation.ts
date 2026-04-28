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
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
