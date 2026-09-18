// @vitest-environment jsdom

import type { ElementType } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, unknown>;
    children?: React.ReactNode;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, String(value));
    }
    return <a href={href}>{children}</a>;
  },
  createLink: (Component: ElementType) =>
    function MockLink(props: Record<string, unknown>) {
      return <Component component="a" {...props} />;
    },
}));

vi.mock("../api/queries", () => ({
  useProject: () => ({ data: { name: "shop", displayName: "Shop" } }),
}));

vi.mock("../../issues/components/IssuesList", () => ({
  IssuesList: ({ projectName }: { projectName: string }) => (
    <div>Issues list for {projectName}</div>
  ),
}));

import { IssuesPage } from "./IssuesPage";

describe("IssuesPage", () => {
  it("uses the project header and renders the issue list", () => {
    render(<IssuesPage projectName="shop" />);

    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Issues list for shop")).toBeInTheDocument();
    expect(screen.queryByText("Issues is on its way")).not.toBeInTheDocument();
  });
});
