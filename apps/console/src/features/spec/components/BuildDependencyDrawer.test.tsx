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
import { describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";
import {
  BuildDependencyDrawer,
  groupPreflightItems,
} from "./BuildDependencyDrawer";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

const AMBIGUOUS: PreflightItem = {
  component: "checkout-api",
  dependency: "crm",
  kind: "external-unresolved",
  description: "No provider chosen yet — choose which one to use.",
};
const UNRESOLVED: PreflightItem = {
  component: "checkout-api",
  dependency: "weather-api",
  kind: "external-unresolved",
  description: "Needs information only you can provide.",
};
const NEEDS_CONTRACT: PreflightItem = {
  component: "checkout-api",
  dependency: "partner-api",
  kind: "external-spec",
  description: "No contract yet — provide the API document to continue.",
};
const ORG_SERVICE: PreflightItem = {
  component: "checkout-api",
  dependency: "billing-service",
  kind: "org-service",
  description: "Billing service endpoint",
};
// The two kinds the drawer never renders: their values / approvals are settled
// elsewhere (Builds page + deploy gate), so they only ride along in the request
// Continue sends.
const EXTERNAL_CONFIG: PreflightItem = {
  component: "checkout-api",
  dependency: "stripe-config",
  kind: "external-config",
  description: "Stripe API credentials",
  config: [{ key: "STRIPE_API_KEY", secret: true, description: "Your Stripe key" }],
};
const PLATFORM_RESOURCE: PreflightItem = {
  component: "checkout-api",
  dependency: "postgres",
  kind: "platform-resource",
  description: "Postgres database",
  resourceType: "postgres-cnpg",
  parameters: { instances: 1 },
};

function setup(items: PreflightItem[], submitting = false) {
  const onClose = vi.fn();
  const onContinue = vi.fn();
  const onOpenDependency = vi.fn();
  const onResolveAll = vi.fn();
  render(
    <BuildDependencyDrawer
      open
      items={items}
      submitting={submitting}
      onClose={onClose}
      onContinue={onContinue}
      onOpenDependency={onOpenDependency}
      onResolveAll={onResolveAll}
    />,
  );
  return { onClose, onContinue, onOpenDependency, onResolveAll };
}

describe("BuildDependencyDrawer — lists what blocks the cut", () => {
  it("renders a row per blocking dependency and nothing for the rest", () => {
    setup([AMBIGUOUS, UNRESOLVED, NEEDS_CONTRACT, ORG_SERVICE, EXTERNAL_CONFIG, PLATFORM_RESOURCE]);

    for (const name of ["crm", "weather-api", "partner-api", "billing-service"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText("stripe-config")).not.toBeInTheDocument();
    expect(screen.queryByText("postgres")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/STRIPE_API_KEY/i)).not.toBeInTheDocument();
  });

  it("renders each row's plain-language reason", () => {
    setup([AMBIGUOUS, NEEDS_CONTRACT]);

    expect(screen.getByText(/no provider chosen yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no contract yet/i)).toBeInTheDocument();
  });

  it("never offers a local input — the dependency's definition owns uploads", () => {
    setup([AMBIGUOUS, NEEDS_CONTRACT]);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("folds a dependency several components declare into one row that names them", () => {
    setup([AMBIGUOUS, { ...AMBIGUOUS, component: "notification-api" }]);

    expect(screen.getAllByText("crm")).toHaveLength(1);
    expect(screen.getByText("Used by:")).toBeInTheDocument();
    expect(screen.getByText("checkout-api")).toBeInTheDocument();
    expect(screen.getByText("notification-api")).toBeInTheDocument();
  });

  it("shows an all-clear message when nothing is left to resolve", () => {
    setup([EXTERNAL_CONFIG, PLATFORM_RESOURCE]);

    expect(screen.getByText(/everything is resolved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /resolve all/i })).not.toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = setup([AMBIGUOUS]);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("BuildDependencyDrawer — the two ways forward", () => {
  it("keeps Continue disabled while any blocking row is present", () => {
    setup([AMBIGUOUS]);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("opens an external dependency's definition from its row", () => {
    const { onOpenDependency } = setup([NEEDS_CONTRACT]);

    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(onOpenDependency).toHaveBeenCalledWith("partner-api");
  });

  it("offers no page for an org-service — that is resolved from the design view", () => {
    setup([ORG_SERVICE]);

    expect(screen.queryByRole("button", { name: /open/i })).not.toBeInTheDocument();
  });

  it("runs the guided flow over every open dependency from one button", () => {
    const { onResolveAll } = setup([AMBIGUOUS, NEEDS_CONTRACT]);

    fireEvent.click(screen.getByRole("button", { name: /resolve all in chat/i }));

    expect(onResolveAll).toHaveBeenCalledTimes(1);
  });

  it("re-enables Continue once the blocker is no longer in items (a resolved refetch)", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <BuildDependencyDrawer open items={[AMBIGUOUS]} onClose={onClose} onContinue={onContinue} />,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    rerender(<BuildDependencyDrawer open items={[]} onClose={onClose} onContinue={onContinue} />);

    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });
});

describe("BuildDependencyDrawer — Continue carries the approvals, never the blockers", () => {
  it("sends platform-resource and org-service approvals, nothing for external config", () => {
    const { onContinue } = setup([EXTERNAL_CONFIG, PLATFORM_RESOURCE]);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const inputs = onContinue.mock.calls[0]![0] as BuildInputItem[];
    expect(inputs).toEqual([
      {
        component: "checkout-api",
        dependency: "postgres",
        kind: "platform-resource",
        approved: true,
        parameters: { instances: 1 },
      },
    ]);
  });

  it("disables Continue and Cancel while submitting", () => {
    setup([EXTERNAL_CONFIG], true);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});

describe("groupPreflightItems", () => {
  it("groups by kind and dependency name, sorting consumers", () => {
    const groups = groupPreflightItems([
      { ...AMBIGUOUS, component: "z-api" },
      { ...AMBIGUOUS, component: "a-api" },
      UNRESOLVED,
    ]);
    expect(groups.map((g) => g.key)).toEqual(["external-unresolved:crm", "external-unresolved:weather-api"]);
    expect(groups[0]!.usedBy).toEqual(["a-api", "z-api"]);
    expect(groups[0]!.representative.component).toBe("a-api");
  });
});
