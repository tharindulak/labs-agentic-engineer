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

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("../api/queries", () => ({
  useProject: () => ({ data: { name: "demo-shop", displayName: "Demo Shop" } }),
}));

let issuesListProjectName = "";
vi.mock("../../issues/components/IssuesList", () => ({
  IssuesList: ({ projectName }: { projectName: string }) => {
    issuesListProjectName = projectName;
    return <div>issues-list-stub</div>;
  },
}));

import { IssuesPage } from "./IssuesPage";

describe("IssuesPage", () => {
  it("renders the header and hands its projectName straight to IssuesList", () => {
    render(<IssuesPage projectName="demo-shop" />);
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("issues-list-stub")).toBeInTheDocument();
    expect(issuesListProjectName).toBe("demo-shop");
  });
});
