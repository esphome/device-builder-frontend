export const STARTER_DEVICE_NAME = "esphome-starter";

export type TourStepKind = "action" | "info";
export type TourSide = "top" | "bottom" | "left" | "right";
export type TourRoute = "dashboard" | "device";

export interface TourStep {
  anchors: string[];
  /** Optional click targets when the visual spotlight covers a larger region. */
  actionAnchors?: string[];
  /** Extra anchors merged into the spotlight hole (not click targets) so the
   *  bubble also keeps clear of context the step talks about. */
  highlightAnchors?: string[];
  route: TourRoute;
  side: TourSide;
  kind: TourStepKind;
  titleKey: string;
  bodyKey: string;
  hintKey?: string;
  nextLabelKey?: string;
}

export const DIALOG_ANCHORS: ReadonlySet<string> = new Set([
  "create-method-basic",
  "board-featured",
  "name-finish",
  "wifi-tour-continue",
]);

export const TOUR_STEPS: readonly TourStep[] = [
  {
    anchors: ["create-device-fab", "add-device-card"],
    route: "dashboard",
    side: "top",
    kind: "action",
    titleKey: "tour.steps.create.title",
    bodyKey: "tour.steps.create.body",
    hintKey: "tour.steps.create.hint",
  },
  {
    anchors: ["create-method-basic"],
    route: "dashboard",
    side: "right",
    kind: "action",
    titleKey: "tour.steps.method.title",
    bodyKey: "tour.steps.method.body",
    hintKey: "tour.steps.method.hint",
  },
  {
    anchors: ["board-featured"],
    route: "dashboard",
    side: "top",
    kind: "action",
    titleKey: "tour.steps.board.title",
    bodyKey: "tour.steps.board.body",
    hintKey: "tour.steps.board.hint",
  },
  {
    anchors: ["name-finish"],
    highlightAnchors: ["name-field"],
    route: "dashboard",
    side: "top",
    kind: "action",
    titleKey: "tour.steps.name.title",
    bodyKey: "tour.steps.name.body",
    hintKey: "tour.steps.name.hint",
  },
  {
    anchors: ["wifi-tour-continue"],
    // Creation is asynchronous; anchor churn advances only after the device
    // page mounts, so failures keep this step visible in the wizard.
    actionAnchors: [],
    // The credential inputs the hint asks for; keeping them in the hole
    // keeps the bubble (and the dim) off them on small viewports.
    highlightAnchors: ["wifi-fields"],
    route: "dashboard",
    side: "top",
    kind: "action",
    titleKey: "tour.steps.wifi.title",
    bodyKey: "tour.steps.wifi.body",
    hintKey: "tour.steps.wifi.hint",
  },
  {
    // The open navigator when visible, else the toggle that reveals it.
    anchors: [
      "nav-mobile-core-item",
      "nav-core-item",
      "nav-mobile-core",
      "nav",
      "nav-toggle",
    ],
    actionAnchors: ["nav-mobile-core-item", "nav-core-item"],
    route: "device",
    side: "right",
    kind: "action",
    titleKey: "tour.steps.navigator.title",
    bodyKey: "tour.steps.navigator.body",
    hintKey: "tour.steps.navigator.hint",
  },
  {
    anchors: ["central"],
    route: "device",
    side: "left",
    kind: "info",
    titleKey: "tour.steps.central.title",
    bodyKey: "tour.steps.central.body",
    nextLabelKey: "tour.got_it",
  },
  {
    anchors: ["yaml"],
    route: "device",
    side: "left",
    kind: "info",
    titleKey: "tour.steps.yaml.title",
    bodyKey: "tour.steps.yaml.body",
    nextLabelKey: "tour.got_it",
  },
  {
    anchors: ["layout-toggle"],
    route: "device",
    side: "bottom",
    kind: "info",
    titleKey: "tour.steps.layout.title",
    bodyKey: "tour.steps.layout.body",
    nextLabelKey: "tour.got_it",
  },
  {
    anchors: ["install"],
    route: "device",
    side: "top",
    kind: "info",
    titleKey: "tour.steps.install.title",
    bodyKey: "tour.steps.install.body",
    nextLabelKey: "tour.got_it",
  },
  {
    anchors: ["tour-device"],
    route: "dashboard",
    side: "bottom",
    kind: "info",
    titleKey: "tour.steps.dashboard.title",
    bodyKey: "tour.steps.dashboard.body",
  },
];
