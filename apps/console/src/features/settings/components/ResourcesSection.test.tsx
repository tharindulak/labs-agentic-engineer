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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ElementType } from "react";
import type { components } from "../../../generated/aep-api";
import { ResourcesSection } from "./ResourcesSection";

// Router replaced so the drawer's "Used by" ProjectLink renders as a plain
// anchor (createLink pattern, cf. ValidationPage.test).
vi.mock("@tanstack/react-router", () => ({
  createLink: (Component: ElementType) =>
    function MockLink({
      to,
      params,
      ...rest
    }: { to: string; params?: Record<string, unknown> } & Record<string, unknown>) {
      let href = to;
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, String(value));
      }
      return <Component component="a" href={href} {...rest} />;
    },
}));

type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];

// Query hooks: replaced wholesale so the test needs neither a
// QueryClientProvider nor MSW — only the rendering under test is real.
let platformState: {
  data?: PlatformResourceTypeDTO[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
} = { data: [], isLoading: false, isError: false };
let externalState: {
  data?: ExternalResourceDTO[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
} = { data: [], isLoading: false, isError: false };

vi.mock("../api/queries", () => ({
  usePlatformResourceTypes: () => platformState,
  useExternalResources: () => externalState,
}));

function resetState() {
  platformState = { data: [], isLoading: false, isError: false };
  externalState = { data: [], isLoading: false, isError: false };
}

describe("ResourcesSection", () => {
  it("defaults to the Platform Resources tab and shows a loading indicator", () => {
    resetState();
    platformState = { isLoading: true, isError: false };

    render(<ResourcesSection />);

    expect(screen.getByLabelText("Loading platform resources")).toBeInTheDocument();
  });

  it("shows an error alert when the platform resources query fails", () => {
    resetState();
    platformState = {
      isLoading: false,
      isError: true,
      error: new Error("boom"),
    };

    render(<ResourcesSection />);

    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("shows the true-empty state when there are no platform resources", () => {
    resetState();

    render(<ResourcesSection />);

    expect(screen.getByText("No platform resources")).toBeInTheDocument();
    expect(
      screen.getByText(/a platform engineer installs these into the cluster/i),
    ).toBeInTheDocument();
  });

  it("shows the true-empty state for external resources on that tab", () => {
    resetState();

    render(<ResourcesSection />);
    fireEvent.click(screen.getByRole("tab", { name: /external resources/i }));

    expect(screen.getByText("No external resources")).toBeInTheDocument();
    expect(
      screen.getByText(/once a third-party dependency is provisioned/i),
    ).toBeInTheDocument();
  });

  it("renders a card per platform resource and opens the drawer on click", async () => {
    resetState();
    platformState = {
      isLoading: false,
      isError: false,
      data: [
        {
          name: "postgres-cnpg",
          description: "Managed Postgres via CloudNativePG",
          consumers: [{ componentName: "checkout-api", projectId: "acme" }],
        },
        {
          name: "redis",
          description: "Managed Redis cache",
          consumers: [],
        },
      ],
    };

    render(<ResourcesSection />);

    expect(screen.getByText("postgres-cnpg")).toBeInTheDocument();
    expect(screen.getByText("Used by 1")).toBeInTheDocument();
    expect(screen.getByText("redis")).toBeInTheDocument();
    // Zero consumers omits the caption entirely.
    expect(screen.queryByText("Used by 0")).not.toBeInTheDocument();

    // Drawer is closed until a card is clicked (MUI unmounts closed content).
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("postgres-cnpg"));

    // The drawer header repeats the resource name — assert there are now two.
    expect(screen.getAllByText("postgres-cnpg")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Close"));
    // The drawer's exit transition unmounts asynchronously.
    await waitFor(() =>
      expect(screen.queryByLabelText("Close")).not.toBeInTheDocument(),
    );
  });
});
