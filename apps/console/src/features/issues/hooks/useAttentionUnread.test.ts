import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/aep-api";
import type { IssueInfo } from "../api/queries";
import {
  attentionItemId,
  collectAttentionItems,
  countUnreadAttention,
} from "./useAttentionUnread";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];

function report(issueNumber?: number): RcaAgentReport {
  return {
    id: `r-${issueNumber ?? "none"}`,
    title: "Alert",
    summary: "summary",
    diagnosis: "diagnosis",
    project: "shop",
    classification: "code-level",
    createdAt: "2026-09-18T00:00:00Z",
    dispatched: true,
    deployed: false,
    ...(issueNumber ? { issueNumber } : {}),
  };
}

describe("attention unread helpers", () => {
  it("collects only alert-linked issues with server attention reasons", () => {
    const issues: IssueInfo[] = [
      {
        Number: 1,
        Title: "ordinary",
        Body: "",
        URL: "https://github.com/acme/shop/issues/1",
        State: "open",
        Labels: ["sre-agent"],
      },
      {
        Number: 2,
        Title: "low confidence",
        Body: "",
        URL: "https://github.com/acme/shop/issues/2",
        State: "open",
        Labels: ["sre-agent"],
        attentionReason: "unverified_fix",
      },
      {
        Number: 3,
        Title: "repeated",
        Body: "",
        URL: "https://github.com/acme/shop/issues/3",
        State: "open",
        Labels: ["sre-agent"],
        attentionReason: "escalated",
      },
    ];

    const items = collectAttentionItems(
      [report(1), report(2), report(3), report()],
      new Map([["shop", issues]]),
    );

    expect(items.map((item) => item.id)).toEqual([
      "shop#2:unverified_fix",
      "shop#3:escalated",
    ]);
  });

  it("does not count viewed attention items as unread", () => {
    const items = [
      {
        id: attentionItemId("shop", 2, "unverified_fix"),
        projectName: "shop",
        issueNumber: 2,
        title: "low confidence",
        reason: "unverified_fix" as const,
      },
      {
        id: attentionItemId("shop", 3, "no_change_verdict"),
        projectName: "shop",
        issueNumber: 3,
        title: "no code fix",
        reason: "no_change_verdict" as const,
      },
    ];

    expect(countUnreadAttention(items, ["shop#2:unverified_fix"])).toBe(1);
  });
});
