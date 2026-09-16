import type { components } from "../../generated/aep-api";

type IssueInfo = components["schemas"]["IssueInfo"];
type ApiError = components["schemas"]["Error"];

// Scenario switch (api-guidelines: mocks must produce empty AND error
// states). Toggle in the browser devtools:
//   localStorage.setItem('aep:mock:issues', 'empty' | 'some' | 'error')
export type IssuesScenario = "empty" | "some" | "error";

// Keyed by project name (list-issues is project-scoped) — the same project
// names seedAlerts and seedProjects already use, so the fan-out bell query
// (Task 8) has something to show across more than one project.
export const seedIssuesByProject: Record<string, IssueInfo[]> = {
  "demo-shop": [
    {
      Number: 201,
      Title: "checkout-service: add timeout/retry around payment-gateway client",
      Body: "## Diagnosis\n\nThe payment-gateway client has no timeout/retry policy.",
      URL: "https://github.com/acme-dev/demo-shop/issues/201",
      State: "open",
      StateReason: "",
      AttentionReason: "",
      Labels: ["sre-agent", "aep"],
    },
    {
      Number: 198,
      Title: "checkout-service: apply discount before tax in order-total calculation",
      Body:
        "## Diagnosis\n\nOrder-total calculation applies the discount after tax.\n\n" +
        "## Recurrence 2\n\nSame failure again.\n\n" +
        "## Recurrence 3\n\nSame failure again.\n\n" +
        "## Recurrence 4\n\nSame failure again.\n\n" +
        "> **Escalated** — this is attempt 4.",
      URL: "https://github.com/acme-dev/demo-shop/issues/198",
      State: "open",
      StateReason: "",
      AttentionReason: "escalated",
      Labels: ["sre-agent", "aep", "aep:codingagent"],
    },
    {
      Number: 190,
      Title: "checkout-service: verify payment retry fix",
      Body: "## Diagnosis\n\nMerged without a Confidence:high declaration.",
      URL: "https://github.com/acme-dev/demo-shop/issues/190",
      State: "open",
      StateReason: "",
      AttentionReason: "unverified_fix",
      Labels: ["sre-agent", "aep:codingagent"],
    },
    {
      Number: 175,
      Title: "checkout-service: intermittent slow queries",
      Body: "## Diagnosis\n\nMatches the service's documented rate-limit behavior.",
      URL: "https://github.com/acme-dev/demo-shop/issues/175",
      State: "closed",
      StateReason: "not_planned",
      AttentionReason: "no_change_verdict",
      Labels: ["sre-agent"],
    },
  ],
  "gym-tracker": [
    {
      Number: 189,
      Title: "workout-api: invalidate workout-history cache entry synchronously on delete",
      Body: "## Diagnosis\n\nThe read path serves from a cache with a 2-minute TTL.",
      URL: "https://github.com/acme-dev/gym-tracker/issues/189",
      State: "open",
      StateReason: "",
      AttentionReason: "",
      Labels: ["sre-agent", "aep"],
    },
    {
      Number: 180,
      Title: "workout-api: verify pool-size fix under load",
      Body: "## Diagnosis\n\nMerged without a Confidence:high declaration.",
      URL: "https://github.com/acme-dev/gym-tracker/issues/180",
      State: "open",
      StateReason: "",
      AttentionReason: "unverified_fix",
      Labels: ["sre-agent", "aep:codingagent"],
    },
  ],
};

export const emptyIssues: IssueInfo[] = [];

export const issuesError: ApiError = {
  code: "internal_error",
  message: "Mock error scenario for issues",
};
