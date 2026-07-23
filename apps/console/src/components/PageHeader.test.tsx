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
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Projects" />);
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("renders the subtitle when given", () => {
    render(<PageHeader title="Settings" subtitle="Org-level configuration" />);
    expect(screen.getByText("Org-level configuration")).toBeInTheDocument();
  });

  it("omits the subtitle when not given", () => {
    render(<PageHeader title="Settings" />);
    expect(
      screen.queryByText("Org-level configuration"),
    ).not.toBeInTheDocument();
  });

  it("renders a status chip beside the title when given", () => {
    render(
      <PageHeader
        title="acme-web"
        status={{ label: "Building", tone: "info" }}
      />,
    );
    expect(screen.getByText("Building")).toBeInTheDocument();
    // The header status is rendered with the low-emphasis "soft" appearance —
    // a tinted sx background rather than the solid MuiChip color class — so a
    // status beside the title reads as a label, not a button.
    expect(screen.getByText("Building").closest(".MuiChip-root")).toBeInTheDocument();
  });

  it("omits the status chip when not given", () => {
    render(<PageHeader title="acme-web" />);
    expect(screen.queryByText(/Building|Failed|Active/)).not.toBeInTheDocument();
  });

  it("renders one back link, in the given link element, with the given label", () => {
    render(
      <PageHeader
        title="Builds"
        backTo={{ link: <a href="/projects/acme" />, label: "Back to overview" }}
      />,
    );
    const link = screen.getByRole("link", { name: /Back to overview/ });
    expect(link).toHaveAttribute("href", "/projects/acme");
  });

  it("omits the back link when not given", () => {
    render(<PageHeader title="Projects" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders right-aligned actions when given", () => {
    render(
      <PageHeader
        title="Projects"
        actions={<button type="button">Create project</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeInTheDocument();
  });

  it("renders no actions when omitted", () => {
    render(<PageHeader title="Projects" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
