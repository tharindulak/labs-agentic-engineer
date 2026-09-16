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

type IssueInfo = components["schemas"]["IssueInfo"];

let mockIssues: IssueInfo[] = [];
let mockState = { isPending: false, isError: false };
const refetch = vi.fn();
vi.mock("../api/queries", () => ({
  useProjectIssues: () => ({
    data: mockIssues,
    isPending: mockState.isPending,
    isError: mockState.isError,
    error: mockState.isError ? new Error("boom") : null,
    refetch,
  }),
}));

import { IssuesList } from "./IssuesList";

const issue = (over: Partial<IssueInfo> = {}): IssueInfo => ({
  Number: 12,
  Title: "checkout-service: apply discount before tax",
  Body: "body",
  URL: "https://github.com/acme/demo-shop/issues/12",
  State: "open",
  StateReason: "",
  AttentionReason: "",
  Labels: ["sre-agent"],
  ...over,
});

beforeEach(() => {
  mockIssues = [];
  mockState = { isPending: false, isError: false };
  refetch.mockClear();
});

describe("IssuesList", () => {
  it("shows the empty state when there are no issues", () => {
    render(<IssuesList projectName="demo-shop" />);
    expect(screen.getByText("No issues yet")).toBeInTheDocument();
  });

  it("shows a retryable error state", () => {
    mockState = { isPending: false, isError: true };
    render(<IssuesList projectName="demo-shop" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders each issue's title and attention chip", () => {
    mockIssues = [issue({ AttentionReason: "escalated" })];
    render(<IssuesList projectName="demo-shop" />);
    expect(
      screen.getByText("checkout-service: apply discount before tax"),
    ).toBeInTheDocument();
    expect(screen.getByText("Escalated")).toBeInTheDocument();
  });

  it("opens the issue's GitHub URL on row click", () => {
    mockIssues = [issue()];
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<IssuesList projectName="demo-shop" />);
    fireEvent.click(screen.getByText("checkout-service: apply discount before tax"));
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/acme/demo-shop/issues/12",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
