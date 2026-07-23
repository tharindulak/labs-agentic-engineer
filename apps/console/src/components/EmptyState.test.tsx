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
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the icon, title, and description", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon">icon</span>}
        title="No projects yet"
        description="Tell AEP what you want to build."
      />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No projects yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tell AEP what you want to build."),
    ).toBeInTheDocument();
  });

  it("renders the action when provided", () => {
    render(
      <EmptyState
        title="No alerts yet"
        description="Reports show up here."
        action={<button type="button">Create project</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("renders no action when omitted", () => {
    render(<EmptyState title="No alerts yet" description="Reports show up here." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("omits the heading and icon in compact mode when none is given", () => {
    render(<EmptyState description="Nothing in production yet." compact />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.getByText("Nothing in production yet."),
    ).toBeInTheDocument();
  });
});
