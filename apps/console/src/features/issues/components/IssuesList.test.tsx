// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueInfo } from "../api/queries";

let mockIssues: IssueInfo[] = [];
let mockPending = false;
let mockError: Error | null = null;

vi.mock("../api/queries", () => ({
  useProjectIssues: () => ({
    data: mockIssues,
    isPending: mockPending,
    isError: Boolean(mockError),
    error: mockError,
    refetch: vi.fn(),
  }),
}));

import { IssuesList } from "./IssuesList";

beforeEach(() => {
  mockPending = false;
  mockError = null;
  mockIssues = [
    {
      Number: 42,
      Title: "checkout-service returns 500",
      Body: "The SRE agent found a code-level issue.",
      URL: "https://github.com/acme/shop/issues/42",
      State: "open",
      Labels: ["bug", "sre-agent", "aep"],
    },
    {
      Number: 43,
      Title: "inventory-worker fix needs verification",
      Body: "The coding agent left this open.",
      URL: "https://github.com/acme/shop/issues/43",
      State: "open",
      Labels: ["bug", "sre-agent"],
      attentionReason: "unverified_fix",
    },
    {
      Number: 44,
      Title: "auth-service timeout recurred",
      Body: "Repeated recurrence.",
      URL: "https://github.com/acme/shop/issues/44",
      State: "open",
      Labels: ["bug", "sre-agent"],
      attentionReason: "escalated",
    },
  ];
});

describe("IssuesList", () => {
  it("renders GitHub issue rows and labels", () => {
    render(<IssuesList projectName="shop" />);

    expect(screen.getByText("#42 checkout-service returns 500")).toBeInTheDocument();
    expect(screen.getAllByText("bug")).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: /View on GitHub/i })[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/shop/issues/42",
    );
  });

  it("renders server-provided attention reasons without deriving policy", () => {
    render(<IssuesList projectName="shop" />);

    expect(screen.getByText(/Needs review:/)).toBeInTheDocument();
    expect(screen.getByText(/not confident enough to close/i)).toBeInTheDocument();
    expect(screen.getByText(/Escalated:/)).toBeInTheDocument();
    expect(screen.getByText(/recurred repeatedly/i)).toBeInTheDocument();
  });

  it("renders empty and error states", () => {
    mockIssues = [];
    const { rerender } = render(<IssuesList projectName="shop" />);
    expect(screen.getByText("No issues yet")).toBeInTheDocument();

    mockError = new Error("boom");
    rerender(<IssuesList projectName="shop" />);
    expect(screen.getByText(/Failed to load issues: boom/)).toBeInTheDocument();
  });
});
