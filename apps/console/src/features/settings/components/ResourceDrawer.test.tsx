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

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementType } from "react";
import type { components } from "../../../generated/aep-api";
import { ResourceDrawer } from "./ResourceDrawer";

// Router replaced so the "Used by" ProjectLink renders as a plain anchor
// (createLink pattern, cf. ValidationPage.test).
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

type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];
type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];

// The delete mutation hook is replaced wholesale (as ResourcesSection.test.tsx
// does for the query hooks) so the test needs neither a QueryClientProvider
// nor MSW — only the rendering under test is real.
const mutate = vi.fn();
const reset = vi.fn();
let deleteState: {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  mutate: typeof mutate;
  reset: typeof reset;
};

vi.mock("../api/queries", () => ({
  useDeleteExternalResource: () => deleteState,
}));

function resetDeleteState() {
  mutate.mockReset();
  reset.mockReset();
  deleteState = { isPending: false, isError: false, error: null, mutate, reset };
}

function externalResource(overrides: Partial<ExternalResourceDTO> = {}): ExternalResourceDTO {
  return {
    name: "stripe",
    description: "Stripe payments API",
    config: [
      { key: "STRIPE_API_KEY", secret: true, description: "Secret API key" },
      { key: "STRIPE_WEBHOOK_ID", secret: false },
    ],
    consumers: [],
    ...overrides,
  };
}

function platformResource(
  overrides: Partial<PlatformResourceTypeDTO> = {},
): PlatformResourceTypeDTO {
  return {
    name: "postgres-cnpg",
    description: "Managed Postgres via CloudNativePG",
    parameters: { size: { type: "string", description: "Storage size" } },
    outputs: ["connectionUrl"],
    consumers: [],
    ...overrides,
  };
}

describe("ResourceDrawer", () => {
  beforeEach(() => {
    resetDeleteState();
  });

  it("external, in use: delete is disabled with the remove-dependencies note", () => {
    render(
      <ResourceDrawer
        kind="external"
        resource={externalResource({
          consumers: [
            { componentName: "checkout-api", projectId: "acme" },
            { componentName: "billing-api", projectId: "acme" },
          ],
        })}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Delete resource" })).toBeDisabled();
    expect(
      screen.getByText("Used by 2 component(s) — remove those dependencies first"),
    ).toBeInTheDocument();
    // Each "Used by" item links to its project.
    expect(
      screen.getByRole("link", { name: "checkout-api · acme" }).getAttribute("href"),
    ).toBe("/projects/acme");
  });

  it("external, unused: delete is enabled and confirming calls the delete mutation", () => {
    const onClose = vi.fn();
    render(
      <ResourceDrawer
        kind="external"
        resource={externalResource({ consumers: [] })}
        open
        onClose={onClose}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete resource" });
    expect(deleteButton).toBeEnabled();
    expect(
      screen.queryByText(/remove those dependencies first/),
    ).not.toBeInTheDocument();

    fireEvent.click(deleteButton);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete stripe?")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete resource" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toBe("stripe");

    // Simulate the mutation's onSuccess firing, as the real hook would after
    // the DELETE resolves — the drawer should close.
    const options = mutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("platform: no delete button anywhere", () => {
    render(<ResourceDrawer kind="platform" resource={platformResource()} open onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("collapse rule: a section with > 5 items is collapsed, one with <= 5 is expanded", () => {
    const manyOutputs = Array.from({ length: 6 }, (_, i) => `output${i}`);
    render(
      <ResourceDrawer
        kind="platform"
        resource={platformResource({
          outputs: manyOutputs,
          parameters: { size: {}, tier: {} },
        })}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Outputs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Parameters (inputs)" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("empty section renders a muted None line instead of a blank body", () => {
    render(
      <ResourceDrawer
        kind="external"
        resource={externalResource({ config: [], consumers: [] })}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText("None")).toHaveLength(2);
  });

  it("marks secret config keys with the lock icon, leaves non-secret ones unmarked", () => {
    render(
      <ResourceDrawer kind="external" resource={externalResource()} open onClose={vi.fn()} />,
    );

    expect(screen.getAllByTestId("secret-icon")).toHaveLength(1);
    expect(screen.getByText("STRIPE_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("STRIPE_WEBHOOK_ID")).toBeInTheDocument();
  });
});
