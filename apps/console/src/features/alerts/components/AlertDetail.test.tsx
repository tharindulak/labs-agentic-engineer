/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => navigate,
}));

let mockReport: RcaAgentReport | undefined;
vi.mock("../api/queries", () => ({
  useAlertReport: () => ({
    data: mockReport,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { AlertDetail } from "./AlertDetail";

const report = (over: Partial<RcaAgentReport> = {}): RcaAgentReport => ({
  id: "rca-1",
  project: "demo-shop",
  component: "service1",
  createdAt: "2026-08-14T16:20:00Z",
  title: "Service1 returns 500 when service2 fails",
  summary: "Unhandled upstream failure.",
  classification: "code-level",
  diagnosis: "## Diagnosis\n\nNo error branch.",
  issueNumber: 118,
  issueUrl: "https://github.com/acme/demo-shop/issues/118",
  issueTitle: "service1: handle the upstream failure",
  issueExcerpt: "No branch populates the failure arm...",
  dispatched: true,
  deployed: false,
  ...over,
});

beforeEach(() => {
  mockReport = report();
  navigate.mockClear();
});

describe("Coding Handover — where the build link lands", () => {
  it("opens the Builds ledger rather than naming a version", () => {
    render(<AlertDetail alertId="rca-1" />);

    fireEvent.click(screen.getByRole("button", { name: "View build phase" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectName/builds",
      params: { projectName: "demo-shop" },
    });
  });

  it("sends the undispatched issue to the same ledger", () => {
    mockReport = report({ dispatched: false });
    render(<AlertDetail alertId="rca-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Dispatch from Build" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectName/builds",
      params: { projectName: "demo-shop" },
    });
  });

  // Adoption files the issue into the DEPLOYED version's milestone, so the
  // version working this alert is not derivable from the report. A link that
  // named one would be guessing, and the guess is silent when it is wrong.
  it("never names a version it would have to guess", () => {
    render(<AlertDetail alertId="rca-1" />);

    fireEvent.click(screen.getByRole("button", { name: "View build phase" }));

    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/projects/$projectName/builds/$tag" }),
    );
  });

  it("never routes an alert into the task terminal", () => {
    render(<AlertDetail alertId="rca-1" />);

    fireEvent.click(screen.getByRole("button", { name: "View build phase" }));

    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/projects/$projectName/tasks/$issueNumber" }),
    );
  });

  it("offers no way out when no issue was created", () => {
    // Absent, not undefined: the contract leaves issueNumber optional and the
    // project sets exactOptionalPropertyTypes, so the key has to go entirely.
    const noIssue = report({ dispatched: false });
    delete noIssue.issueNumber;
    mockReport = noIssue;
    render(<AlertDetail alertId="rca-1" />);

    expect(
      screen.queryByRole("button", { name: /build/i }),
    ).not.toBeInTheDocument();
  });
});
