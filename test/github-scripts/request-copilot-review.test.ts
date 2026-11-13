import { describe, expect, it } from "vitest";

type Core = {
  info: (m: string) => void;
  warning: (m: string) => void;
  setFailed: (m: string) => void;
};
type RequestCopilotReview = (args: {
  github: unknown;
  context: unknown;
  core: Core;
}) => Promise<void>;

const requestCopilotReview = (
  (await import("../../.github/scripts/request-copilot-review.cjs")) as {
    default: RequestCopilotReview;
  }
).default;

const REPO = { owner: "esphome", repo: "device-builder-frontend" };

const OLD = "2020-01-01T00:00:00Z";
const LATER = "2020-01-01T00:05:00Z";
// The account the workflow's token belongs to.
const REQUESTER = "esphome-review-bot";
// "ours" is a request filed by REQUESTER; anything else stands for the ruleset
// or a maintainer.
const copilotRequest = (id: number, by: "ours" | "other", createdAt = LATER) => ({
  id,
  event: "review_requested",
  actor: { login: by === "ours" ? REQUESTER : "someone", type: "User" },
  requested_reviewer: { login: "Copilot" },
  created_at: createdAt,
});
const copilotReview = (id: number, submittedAt: string) => ({
  id,
  event: "reviewed",
  user: { login: "Copilot" },
  submitted_at: submittedAt,
});

// before and after are the timeline reads around the request; timelineError
// makes that read throw.
function makeGithub(
  opts: {
    fail?: boolean;
    before?: unknown[];
    after?: unknown[];
    timelineError?: "before" | "after";
    whoamiStatus?: number;
  } = {}
) {
  const calls: Record<string, unknown>[] = [];
  const reads = [
    { name: "before", events: opts.before ?? [] },
    { name: "after", events: opts.after ?? [copilotRequest(1, "ours")] },
  ];
  const listEventsForTimeline = () => {};
  return {
    calls,
    github: {
      paginate: async (fn: unknown) => {
        expect(fn).toBe(listEventsForTimeline);
        const read = reads.shift();
        if (!read) throw new Error("the timeline is read at most twice");
        if (opts.timelineError === read.name) {
          throw new Error("secondary rate limit");
        }
        return read.events;
      },
      rest: {
        users: {
          getAuthenticated: async () => {
            if (opts.whoamiStatus) {
              throw Object.assign(new Error("Bad credentials"), {
                status: opts.whoamiStatus,
              });
            }
            return { data: { login: REQUESTER } };
          },
        },
        issues: { listEventsForTimeline },
        pulls: {
          requestReviewers: async (args: Record<string, unknown>) => {
            if (opts.fail) {
              throw new Error("Reviews may only be requested from collaborators");
            }
            calls.push(args);
          },
        },
      },
    },
  };
}

function makeCore() {
  const warnings: string[] = [];
  const infos: string[] = [];
  const failures: string[] = [];
  const core: Core = {
    info: (m) => void infos.push(m),
    warning: (m) => void warnings.push(m),
    setFailed: (m) => void failures.push(m),
  };
  return { core, warnings, infos, failures };
}

const prContext = (type = "User") => ({
  repo: REPO,
  payload: { pull_request: { number: 9, user: { type } } },
});

describe("request-copilot-review", () => {
  it("requests a Copilot review on a PR event", async () => {
    const { github, calls } = makeGithub();
    const { core, infos, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(calls).toEqual([
      {
        ...REPO,
        pull_number: 9,
        reviewers: ["copilot-pull-request-reviewer[bot]"],
      },
    ]);
    expect(warnings).toEqual([]);
    expect(infos[0]).toMatch(/Requested a Copilot review on #9/);
  });

  it("skips bot PRs", async () => {
    const { github, calls } = makeGithub();
    const { core } = makeCore();
    await requestCopilotReview({ github, context: prContext("Bot"), core });
    expect(calls).toEqual([]);
  });

  it("warns instead of failing when the request fails", async () => {
    const { github } = makeGithub({ fail: true });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/Could not request a Copilot review on #9/);
  });

  it("warns when GitHub accepted the request but recorded none", async () => {
    const { github } = makeGithub({ after: [{ id: 1, event: "labeled" }] });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/recorded none/);
  });

  it("does not take a request filed by another account as ours", async () => {
    const after = [copilotRequest(1, "other"), copilotReview(2, LATER)];
    const { github } = makeGithub({ after });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/recorded none/);
  });

  it("does not take an earlier request by the same account as this one", async () => {
    const earlier = [copilotRequest(1, "ours", OLD), copilotReview(2, LATER)];
    const { github } = makeGithub({ before: earlier, after: earlier });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/recorded none/);
  });

  it("logs a still pending Copilot review instead of warning", async () => {
    const earlier = [copilotReview(1, OLD), copilotRequest(2, "other")];
    const { github } = makeGithub({ before: earlier, after: earlier });
    const { core, infos, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings).toEqual([]);
    expect(infos[0]).toMatch(/requested by someone is still pending on #9/);
  });

  it("does not count a removed Copilot request as pending", async () => {
    const earlier = [
      copilotRequest(1, "other"),
      {
        id: 2,
        event: "review_request_removed",
        requested_reviewer: { login: "Copilot" },
        created_at: LATER,
      },
    ];
    const { github } = makeGithub({ before: earlier, after: earlier });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/recorded none/);
  });

  it("ends a pending request on a review under the bot account login", async () => {
    const earlier = [
      copilotRequest(1, "other", OLD),
      {
        id: 2,
        event: "reviewed",
        user: { login: "copilot-pull-request-reviewer[bot]" },
        submitted_at: LATER,
      },
    ];
    const { github } = makeGithub({ before: earlier, after: earlier });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(warnings[0]).toMatch(/recorded none/);
  });

  it("warns when the timeline read after the request fails", async () => {
    const { github, calls } = makeGithub({ timelineError: "after" });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(calls).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not confirm it: secondary rate limit/);
  });

  it("still requests the review when the baseline read fails", async () => {
    const { github, calls } = makeGithub({ timelineError: "before" });
    const { core, warnings } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(calls).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/goes unconfirmed: secondary rate limit/);
  });

  it("fails the run when the token is rejected", async () => {
    const { github, calls } = makeGithub({ whoamiStatus: 401 });
    const { core, failures } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(calls).toHaveLength(0);
    expect(failures[0]).toMatch(/COPILOT_REVIEW_TOKEN was rejected/);
  });

  it("still requests the review when the account lookup fails", async () => {
    const { github, calls } = makeGithub({ whoamiStatus: 502 });
    const { core, warnings, failures } = makeCore();
    await requestCopilotReview({ github, context: prContext(), core });
    expect(calls).toHaveLength(1);
    expect(failures).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Could not identify the requesting account/);
  });
});
