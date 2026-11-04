import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks } from "../../_dom.js";
import {
  EditorLayout,
  ExperienceLevel,
  type OnboardingState,
  OnboardingStepId,
  OnboardingStepStatus,
  SecretsEditorLayout,
  type UserPreferences,
} from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import {
  applyDashboardSnapshot,
  loadOnboardingState,
  loadPreferences,
  onDashboardPrefsChanged,
} from "../../../src/components/app-shell/data-load.js";
import type { DashboardPrefs, DashboardPrefsChange } from "../../../src/context/index.js";
import { fetchSecretKeys } from "../../../src/util/secrets-cache.js";

// loadOnboardingState reads the shared (session-cached) secret-keys list; mock
// it so the kebab-wording flag is driven per-test without cache bleed.
vi.mock("../../../src/util/secrets-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/secrets-cache.js")>()),
  fetchSecretKeys: vi.fn(async () => [] as string[]),
}));

const DONE = OnboardingStepStatus.DONE;
const PENDING = OnboardingStepStatus.PENDING;

beforeEach(() => {
  vi.mocked(fetchSecretKeys).mockResolvedValue([]);
});

function state(
  steps: Array<{ id: OnboardingStepId; status: OnboardingStepStatus }>,
  completed_version = 0,
  current_version = 2
): OnboardingState {
  return { current_version, completed_version, steps };
}

function makeHost(state: OnboardingState) {
  return {
    _onboardingPending: false,
    _onboardingShouldShow: false,
    _api: { getOnboardingState: vi.fn(async () => state) },
  };
}

describe("loadOnboardingState routing", () => {
  it("a fresh install (experience pending) auto-pops the first-run wizard", async () => {
    const host = makeHost(
      state([
        { id: OnboardingStepId.USE_CASE, status: PENDING },
        { id: OnboardingStepId.EXPERIENCE_LEVEL, status: PENDING },
      ])
    );
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShouldShow).toBe(true);
  });

  it("an existing install (experience done) does not auto-pop the wizard", async () => {
    const host = makeHost(
      state([{ id: OnboardingStepId.EXPERIENCE_LEVEL, status: DONE }])
    );
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShouldShow).toBe(false);
  });

  it("flags Wi-Fi as pending (kebab wording) when no wifi_ssid secret exists", async () => {
    vi.mocked(fetchSecretKeys).mockResolvedValue(["api_key"]);
    const host = makeHost(state([]));
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingPending).toBe(true);
  });

  it("stays pending when only wifi_ssid exists (needs the password key too)", async () => {
    vi.mocked(fetchSecretKeys).mockResolvedValue(["wifi_ssid"]);
    const host = makeHost(state([]));
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingPending).toBe(true);
  });

  it("clears the Wi-Fi pending flag once both wifi_ssid and wifi_password exist", async () => {
    vi.mocked(fetchSecretKeys).mockResolvedValue(["wifi_ssid", "wifi_password"]);
    const host = makeHost(state([]));
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingPending).toBe(false);
  });
});

describe("loadPreferences (post-wizard context refresh)", () => {
  const prefs: UserPreferences = {
    dashboard_view: "cards" as UserPreferences["dashboard_view"],
    theme: "dark" as UserPreferences["theme"],
    navigator_visible: true,
    device_editor_layout: EditorLayout.BOTH,
    secrets_editor_layout: SecretsEditorLayout.VISUAL,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    experience_level: ExperienceLevel.EXPERT,
    remote_compute_only: true,
    hide_device_builder: false,
    version_history_enabled: true,
    onboarding_completed_version: 2,
  };

  function makePrefsHost() {
    return {
      _prefsWritesInFlight: 0,
      _experienceLevel: null as ExperienceLevel | null,
      _remoteComputeOnly: false,
      _prefsLoaded: false,
      applyTheme: vi.fn(),
      _api: { getPreferences: vi.fn(async () => prefs) },
    };
  }

  it("skips the refresh while a preference write is in flight", async () => {
    const host = makePrefsHost();
    host._prefsWritesInFlight = 1;
    await loadPreferences(host as unknown as ESPHomeApp);
    expect(host._api.getPreferences).not.toHaveBeenCalled();
    expect(host._remoteComputeOnly).toBe(false);
    expect(host._experienceLevel).toBeNull();
  });

  it("applies prefs and marks loaded when no write is in flight", async () => {
    const host = makePrefsHost();
    await loadPreferences(host as unknown as ESPHomeApp);
    expect(host._experienceLevel).toBe(ExperienceLevel.EXPERT);
    expect(host._remoteComputeOnly).toBe(true);
    expect(host._prefsLoaded).toBe(true);
  });

  it("logs and leaves state intact on a fetch failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = makePrefsHost();
      host._api.getPreferences = vi.fn(async () => {
        throw new Error("boom");
      });
      await loadPreferences(host as unknown as ESPHomeApp);
      expect(host._prefsLoaded).toBe(false);
      expect(host._remoteComputeOnly).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

const dashPrefs = (over: Partial<DashboardPrefs> = {}): DashboardPrefs => ({
  dashboard_view: "cards" as DashboardPrefs["dashboard_view"],
  table_page_size: 25,
  table_column_visibility: {},
  table_sort_column: null,
  table_sort_direction: null,
  ...over,
});

function makeShell(current: DashboardPrefs | null = dashPrefs()) {
  return {
    _dashboardPrefs: current,
    _dashboardWritesInFlight: 0,
    _pendingDashboardPrefs: {} as Partial<DashboardPrefs>,
    _dashboardWroteSinceSnapshot: false,
    _api: {
      getPreferences: vi.fn(async () => dashPrefs() as unknown as UserPreferences),
    },
  };
}

const TABLE = "table" as DashboardPrefs["dashboard_view"];
const change = (prefs: Partial<DashboardPrefs>, phase: DashboardPrefsChange["phase"]) =>
  new CustomEvent<DashboardPrefsChange>("dashboard-prefs-changed", {
    detail: { prefs, phase },
  });
const send = (
  shell: ReturnType<typeof makeShell>,
  e: CustomEvent<DashboardPrefsChange>
) => onDashboardPrefsChanged(shell as unknown as ESPHomeApp, e);
const snapshot = (shell: ReturnType<typeof makeShell>, prefs: DashboardPrefs) =>
  applyDashboardSnapshot(
    shell as unknown as ESPHomeApp,
    prefs as unknown as UserPreferences
  );

describe("onDashboardPrefsChanged", () => {
  it("merges a starting write and keeps it pending until it settles", () => {
    const shell = makeShell();
    send(shell, change({ table_page_size: 50 }, "start"));
    expect(shell._dashboardPrefs?.table_page_size).toBe(50);
    expect(shell._pendingDashboardPrefs).toEqual({ table_page_size: 50 });

    send(shell, change(dashPrefs({ table_page_size: 50 }), "settle"));
    expect(shell._dashboardWritesInFlight).toBe(0);
    expect(shell._pendingDashboardPrefs).toEqual({});
    expect(shell._dashboardPrefs).toEqual(dashPrefs({ table_page_size: 50 }));
  });

  it("keeps a later write's patch over an earlier write's reply", () => {
    const shell = makeShell();
    send(shell, change({ table_page_size: 50 }, "start"));
    send(shell, change({ dashboard_view: TABLE }, "start"));
    // The first reply predates the second write.
    send(shell, change(dashPrefs({ table_page_size: 50 }), "settle"));
    expect(shell._dashboardPrefs?.dashboard_view).toBe(TABLE);
  });

  it("holds a write made before the first snapshot for that snapshot", () => {
    const shell = makeShell(null);
    send(shell, change({ dashboard_view: TABLE }, "start"));
    expect(shell._dashboardPrefs).toBeNull();
    snapshot(shell, dashPrefs());
    expect(shell._dashboardPrefs?.dashboard_view).toBe(TABLE);
  });
});

describe("applyDashboardSnapshot", () => {
  it("keeps an in-flight write over an older snapshot", () => {
    const shell = makeShell();
    send(shell, change({ dashboard_view: TABLE }, "start"));
    snapshot(shell, dashPrefs());
    expect(shell._dashboardPrefs?.dashboard_view).toBe(TABLE);
  });

  it("refetches after a write that settled before the snapshot arrived", async () => {
    const shell = makeShell();
    send(shell, change({ dashboard_view: TABLE }, "start"));
    send(shell, change(dashPrefs({ dashboard_view: TABLE }), "settle"));
    shell._api.getPreferences.mockResolvedValueOnce(
      dashPrefs({ dashboard_view: TABLE }) as unknown as UserPreferences
    );
    snapshot(shell, dashPrefs());
    await flushMicrotasks(4);
    expect(shell._api.getPreferences).toHaveBeenCalledTimes(1);
    expect(shell._dashboardPrefs?.dashboard_view).toBe(TABLE);
  });

  it("does not refetch when no write happened since the last snapshot", () => {
    const shell = makeShell();
    snapshot(shell, dashPrefs({ table_page_size: 50 }));
    expect(shell._api.getPreferences).not.toHaveBeenCalled();
    expect(shell._dashboardPrefs?.table_page_size).toBe(50);
  });

  it("keeps the snapshot when the refetch fails", async () => {
    const shell = makeShell();
    send(shell, change({ dashboard_view: TABLE }, "start"));
    send(shell, change({}, "settle"));
    shell._api.getPreferences.mockRejectedValueOnce(new Error("offline"));
    snapshot(shell, dashPrefs({ table_page_size: 50 }));
    await flushMicrotasks(4);
    expect(shell._dashboardPrefs).toEqual(dashPrefs({ table_page_size: 50 }));
  });
});
