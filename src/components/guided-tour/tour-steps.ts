export const STARTER_DEVICE_NAME = "esphome-starter";

export type TourStepKind = "action" | "info";
export type TourSide = "top" | "bottom" | "left" | "right";
export type TourRoute = "dashboard" | "device";

export interface TourStep {
  anchors: string[];
  route: TourRoute;
  side: TourSide;
  kind: TourStepKind;
  titleKey: string;
  bodyKey: string;
  hintKey?: string;
}

export const DIALOG_ANCHORS: ReadonlySet<string> = new Set([
  "create-method-basic",
  "board-featured",
  "name-finish",
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
    side: "right",
    kind: "action",
    titleKey: "tour.steps.board.title",
    bodyKey: "tour.steps.board.body",
    hintKey: "tour.steps.board.hint",
  },
  {
    anchors: ["name-finish"],
    route: "dashboard",
    side: "right",
    kind: "action",
    titleKey: "tour.steps.name.title",
    bodyKey: "tour.steps.name.body",
    hintKey: "tour.steps.name.hint",
  },
  {
    anchors: ["nav"],
    route: "device",
    side: "right",
    kind: "info",
    titleKey: "tour.steps.navigator.title",
    bodyKey: "tour.steps.navigator.body",
  },
  {
    anchors: ["central"],
    route: "device",
    side: "left",
    kind: "info",
    titleKey: "tour.steps.central.title",
    bodyKey: "tour.steps.central.body",
  },
  {
    anchors: ["yaml"],
    route: "device",
    side: "left",
    kind: "info",
    titleKey: "tour.steps.yaml.title",
    bodyKey: "tour.steps.yaml.body",
  },
  {
    anchors: ["layout-toggle"],
    route: "device",
    side: "bottom",
    kind: "info",
    titleKey: "tour.steps.layout.title",
    bodyKey: "tour.steps.layout.body",
  },
  {
    anchors: ["install"],
    route: "device",
    side: "top",
    kind: "info",
    titleKey: "tour.steps.install.title",
    bodyKey: "tour.steps.install.body",
  },
  {
    anchors: ["validate"],
    route: "device",
    side: "top",
    kind: "info",
    titleKey: "tour.steps.validate.title",
    bodyKey: "tour.steps.validate.body",
  },
  {
    anchors: ["save"],
    route: "device",
    side: "top",
    kind: "info",
    titleKey: "tour.steps.save.title",
    bodyKey: "tour.steps.save.body",
  },
  {
    anchors: ["view-toggle"],
    route: "dashboard",
    side: "bottom",
    kind: "info",
    titleKey: "tour.steps.dashboard.title",
    bodyKey: "tour.steps.dashboard.body",
  },
  {
    anchors: ["create-device-fab", "add-device-card"],
    route: "dashboard",
    side: "top",
    kind: "info",
    titleKey: "tour.steps.done.title",
    bodyKey: "tour.steps.done.body",
  },
];
