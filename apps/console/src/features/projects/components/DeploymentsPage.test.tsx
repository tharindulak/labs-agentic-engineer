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

import type { ElementType } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

// Router replaced so the internal-link chip renders as a plain anchor whose
// href is the resolved route path — no RouterProvider needed.
vi.mock("@tanstack/react-router", () => ({
  createLink: (Component: ElementType) =>
    function MockLink({
      to,
      params,
      ...rest
    }: {
      to: string;
      params?: Record<string, unknown>;
    } & Record<string, unknown>) {
      let href = to;
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, String(value));
      }
      return <Component component="a" href={href} {...rest} />;
    },
}));

import { DeploymentsPage } from "./DeploymentsPage";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type DeployStage = components["schemas"]["DeployStage"];

// Query hooks replaced wholesale — no QueryClientProvider / MSW needed, only the
// rendering under test is real (mirrors TasksList.test.tsx).
let mockDeploy: DeployStage = {
  version: "v1",
  status: "deployed",
  components: { total: 1, ready: 1 },
  validation: "none",
};

function status(): ProjectStatus {
  return {
    phase: "components",
    repoStatus: "ready",
    repoUrl: "https://github.com/acme/demo",
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v1", dirty: false, design: true },
    build: {
      version: "v1",
      status: "succeeded",
      tasks: { total: 1, done: 1, failed: 0, active: 0 },
    },
    deploy: mockDeploy,
  };
}

vi.mock("../api/queries", () => ({
  useProjectComponents: () => ({
    data: { items: [{ name: "storefront", displayName: "Storefront", type: "web-application" }] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useComponentsDeployments: () => ({
    isPending: false,
    deployments: [
      {
        componentName: "storefront",
        environment: "development",
        status: "Ready",
        endpointUrl: "https://storefront.dev.example.com",
      },
    ],
    failedCount: 0,
  }),
  useProjectStatus: () => ({ data: status() }),
}));

describe("DeploymentsPage — validation chip", () => {
  it("routes a RUNNING validation to the internal log page", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "running",
      validationIssue: 30,
      validationUrl: "https://github.com/acme/demo/issues/30",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /Validating/ });
    expect(chip).toHaveAttribute(
      "href",
      "/projects/acme/deployments/validation/30",
    );
    // Internal navigation, not a new-tab external link.
    expect(chip).not.toHaveAttribute("target");
  });

  it("routes a FAILED validation to the internal log page", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "failed",
      validationIssue: 30,
      validationUrl: "https://github.com/acme/demo/issues/30",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /Validation failed/ });
    expect(chip).toHaveAttribute(
      "href",
      "/projects/acme/deployments/validation/30",
    );
    expect(chip).not.toHaveAttribute("target");
  });

  it("links a COMPLETED validation straight to the PR, not the log page", () => {
    // The report is ready — the issue number is present but the chip must
    // still open the PR externally; the log view adds nothing after the run.
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "completed",
      validationIssue: 30,
      validationUrl: "https://github.com/acme/demo/pull/42",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /Validation report/ });
    expect(chip).toHaveAttribute("href", "https://github.com/acme/demo/pull/42");
    expect(chip).toHaveAttribute("target", "_blank");
  });

  it("shows a PR-linked chip when validation has run", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "completed",
      validationUrl: "https://github.com/acme/demo/pull/42",
    };

    render(<DeploymentsPage projectName="acme" />);

    const chip = screen.getByRole("link", { name: /Validation report/ });
    expect(chip).toHaveAttribute("href", "https://github.com/acme/demo/pull/42");
    expect(chip).toHaveAttribute("target", "_blank");
  });

  it("renders no validation chip when there is nothing to validate", () => {
    mockDeploy = {
      version: "v1",
      status: "deployed",
      components: { total: 1, ready: 1 },
      validation: "none",
    };

    render(<DeploymentsPage projectName="acme" />);

    expect(screen.queryByText(/Validat/)).not.toBeInTheDocument();
  });
});
