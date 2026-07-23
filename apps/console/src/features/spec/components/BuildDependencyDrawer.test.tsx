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
import { BuildDependencyDrawer, groupPreflightItems } from "./BuildDependencyDrawer";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

const ITEMS: PreflightItem[] = [
  {
    component: "checkout-api",
    dependency: "stripe-config",
    kind: "external-config",
    description: "Stripe API credentials",
    config: [
      { key: "STRIPE_API_KEY", secret: true, description: "Your Stripe secret API key" },
      { key: "STRIPE_WEBHOOK_ID", secret: false },
    ],
  },
  {
    component: "checkout-api",
    dependency: "partner-openapi-spec",
    kind: "external-spec",
    description: "Partner API spec",
  },
  {
    component: "checkout-api",
    dependency: "postgres",
    kind: "platform-resource",
    description: "Postgres database",
    resourceType: "postgres",
  },
  {
    component: "checkout-api",
    dependency: "billing-service",
    kind: "org-service",
    description: "Billing service endpoint",
  },
];

function setup(items: PreflightItem[] = ITEMS, submitting = false) {
  const onClose = vi.fn();
  const onContinue = vi.fn();
  const onResolveDependency = vi.fn();
  render(
    <BuildDependencyDrawer
      open
      items={items}
      submitting={submitting}
      onClose={onClose}
      onContinue={onContinue}
      onResolveDependency={onResolveDependency}
    />,
  );
  return { onClose, onContinue, onResolveDependency };
}

describe("BuildDependencyDrawer", () => {
  it("renders a sub-panel per dependency kind present in items", () => {
    setup();

    expect(screen.getByText(/stripe-config/i)).toBeInTheDocument();
    expect(screen.getByText(/partner-openapi-spec/i)).toBeInTheDocument();
    expect(screen.getAllByText(/postgres/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/billing-service/i)).toBeInTheDocument();
  });

  it("shows platform-resource and org-service as informational (no approval checkbox)", () => {
    setup();

    // Continue is the approval, so these kinds render as title + description
    // only — there is no per-item checkbox to toggle.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByText(/postgres/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/billing-service/i)).toBeInTheDocument();
  });

  // A single informational platform-resource requires no input, so Continue is enabled on
  // its own — the ideal fixture to prove that `submitting` is what disables it.
  const PLATFORM_ONLY: PreflightItem[] = [
    {
      component: "api",
      dependency: "notes-db",
      kind: "platform-resource",
      description: "Provision this postgres-cnpg for you",
      resourceType: "postgres-cnpg",
    },
  ];

  it("keeps Continue enabled for an informational platform-resource when not submitting", () => {
    setup(PLATFORM_ONLY, false);
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("shows a spinner on Continue and disables both buttons while submitting", () => {
    const { onContinue } = setup(PLATFORM_ONLY, true);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    // Disabled despite no input being required — the in-flight build is what
    // blocks it, so the request can't be double-submitted.
    expect(continueButton).toBeDisabled();
    // The Continue button (not the Build button behind the drawer) carries the
    // spinner while POST /build is in flight.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // Cancel is locked so the drawer can't be dismissed mid-call.
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

    fireEvent.click(continueButton);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("disables Continue until external-config values and external-spec url/content are filled", () => {
    setup();

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    expect(continueButton).toBeEnabled();
  });

  it("renders a config key's description as helper text under the field", () => {
    setup();

    expect(
      screen.getByText(/Your Stripe secret API key/i),
    ).toBeInTheDocument();
  });

  // defaultValue pre-fills a NON-secret field so the user starts from a sensible
  // suggestion (a region, a base URL); a secret key never carries a default an
  // agent could invent, and the drawer must never pre-fill one even defensively.
  const DEFAULTS: PreflightItem[] = [
    {
      component: "checkout-api",
      dependency: "aws-config",
      kind: "external-config",
      description: "AWS region + credentials",
      config: [
        { key: "AWS_REGION", secret: false, defaultValue: "us-east-1" },
        { key: "AWS_SECRET_KEY", secret: true, defaultValue: "must-not-prefill" },
      ],
    },
  ];

  it("pre-fills a non-secret config key with its defaultValue", () => {
    setup(DEFAULTS);

    expect(screen.getByLabelText(/AWS_REGION/i)).toHaveValue("us-east-1");
  });

  it("never pre-fills a secret config key even when a defaultValue is present", () => {
    setup(DEFAULTS);

    expect(screen.getByLabelText(/AWS_SECRET_KEY/i)).toHaveValue("");
  });

  it("masks secret config fields as password inputs", () => {
    setup();

    expect(screen.getByLabelText(/STRIPE_API_KEY/i)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i)).not.toHaveAttribute(
      "type",
      "password",
    );
  });

  it("emits BuildInputItem[] on Continue with approvals true and typed values", () => {
    const { onContinue } = setup();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];

    const configInput = inputs.find(
      (i) => i.dependency === "stripe-config",
    );
    expect(configInput).toMatchObject({
      component: "checkout-api",
      dependency: "stripe-config",
      kind: "external-config",
      values: expect.arrayContaining([
        { key: "STRIPE_API_KEY", value: "sk_test_123" },
        { key: "STRIPE_WEBHOOK_ID", value: "whsec_456" },
      ]),
    });

    const specInput = inputs.find(
      (i) => i.dependency === "partner-openapi-spec",
    );
    expect(specInput).toMatchObject({
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      specUrl: "https://example.com/openapi.json",
    });

    const resourceInput = inputs.find((i) => i.dependency === "postgres");
    expect(resourceInput).toMatchObject({
      component: "checkout-api",
      dependency: "postgres",
      kind: "platform-resource",
      approved: true,
    });

    const orgServiceInput = inputs.find(
      (i) => i.dependency === "billing-service",
    );
    expect(orgServiceInput).toMatchObject({
      component: "checkout-api",
      dependency: "billing-service",
      kind: "org-service",
      approved: true,
    });
  });

  it("always emits approved:true for platform-resource/org-service (Continue is the approval)", () => {
    const { onContinue } = setup();

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.change(screen.getByLabelText(/STRIPE_WEBHOOK_ID/i), {
      target: { value: "whsec_456" },
    });
    fireEvent.change(screen.getByLabelText(/spec url/i), {
      target: { value: "https://example.com/openapi.json" },
    });

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(
      inputs.find((i) => i.dependency === "postgres"),
    ).toMatchObject({ approved: true });
    expect(
      inputs.find((i) => i.dependency === "billing-service"),
    ).toMatchObject({ approved: true });
  });

  it("accepts a pasted spec via the content field and emits specContent (not specUrl)", () => {
    const specItem: PreflightItem = {
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      description: "Partner API spec",
    };
    const { onContinue } = setup([specItem]);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/spec content/i), {
      target: { value: "openapi: 3.0.0\ninfo:\n  title: Partner API" },
    });

    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    const specInput = inputs.find(
      (i) => i.dependency === "partner-openapi-spec",
    );
    expect(specInput).toMatchObject({
      component: "checkout-api",
      dependency: "partner-openapi-spec",
      kind: "external-spec",
      specContent: "openapi: 3.0.0\ninfo:\n  title: Partner API",
    });
    expect(specInput).not.toHaveProperty("specUrl");
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets to fresh state each time it is reopened", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });

    rerender(
      <BuildDependencyDrawer
        open={false}
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    rerender(
      <BuildDependencyDrawer
        open
        items={ITEMS}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    // The typed external-config value is cleared on reopen.
    expect(screen.getByLabelText(/STRIPE_API_KEY/i)).toHaveValue("");
  });
});

// #252 Task 10: the restored external proceed gate's blocker items
// (external-ambiguous / external-unresolved) — no local form, Continue stays
// disabled while present, and "Resolve via chat" is the only affordance.
describe("BuildDependencyDrawer blocker items (#252 Task 10)", () => {
  const AMBIGUOUS_ITEM: PreflightItem = {
    component: "checkout-api",
    dependency: "crm",
    kind: "external-ambiguous",
    description: "More than one candidate fits — resolve which one to use.",
  };
  const UNRESOLVED_ITEM: PreflightItem = {
    component: "checkout-api",
    dependency: "weather-api",
    kind: "external-unresolved",
    description: "Needs information only you can provide.",
  };

  it("renders the blocker's dependency name and plain-language reason", () => {
    setup([AMBIGUOUS_ITEM, UNRESOLVED_ITEM]);

    expect(screen.getByText("crm")).toBeInTheDocument();
    expect(
      screen.getByText(/more than one candidate fits/i),
    ).toBeInTheDocument();
    expect(screen.getByText("weather-api")).toBeInTheDocument();
    expect(
      screen.getByText(/needs information only you can provide/i),
    ).toBeInTheDocument();
  });

  it("keeps Continue disabled while a blocker item is present, regardless of other items", () => {
    setup([AMBIGUOUS_ITEM]);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("never renders a local input for a blocker item (no textbox)", () => {
    setup([AMBIGUOUS_ITEM, UNRESOLVED_ITEM]);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("fires onResolveDependency with the blocker item and the RESOLVE intent when 'Resolve via chat' is clicked", () => {
    const { onResolveDependency } = setup([AMBIGUOUS_ITEM]);

    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );

    expect(onResolveDependency).toHaveBeenCalledTimes(1);
    expect(onResolveDependency).toHaveBeenCalledWith(AMBIGUOUS_ITEM, "resolve");
  });

  it("re-enables Continue once the blocker item is no longer in items (simulating a resolved refetch)", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={[AMBIGUOUS_ITEM]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // The parent refetched preflight after the chat resolved it — the item
    // is simply gone from the next `items` array.
    rerender(
      <BuildDependencyDrawer
        open
        items={[]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("submits only the config item once the blocker resolves out of items, never a stray blocker entry", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const configItem: PreflightItem = {
      component: "checkout-api",
      dependency: "stripe-config",
      kind: "external-config",
      description: "Stripe API credentials",
      config: [{ key: "STRIPE_API_KEY", secret: true }],
    };
    const { rerender } = render(
      <BuildDependencyDrawer
        open
        items={[AMBIGUOUS_ITEM, configItem]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // Chat resolved the blocker; the parent's refetch drops it from items.
    rerender(
      <BuildDependencyDrawer
        open
        items={[configItem]}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByLabelText(/STRIPE_API_KEY/i), {
      target: { value: "sk_test_123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      dependency: "stripe-config",
      kind: "external-config",
    });
  });

  it("renders 'Resolve via chat' for a still-unfed external-spec item too, alongside its existing form", () => {
    const specItem: PreflightItem = {
      component: "checkout-api",
      dependency: "partner-api",
      kind: "external-spec",
      description: "No API spec yet — provide one to continue.",
    };
    const { onResolveDependency } = setup([specItem]);

    // The pre-existing local form is untouched...
    expect(screen.getByLabelText(/spec url/i)).toBeInTheDocument();
    // ...and the new chat affordance sits alongside it.
    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );
    expect(onResolveDependency).toHaveBeenCalledWith(specItem, "resolve");
  });
});

// #252 Task 15: Task 14 lifted the ComponentType!=service preflight guard, so
// a project-scoped shared dependency (the canonical case: `thunder-app`
// end-user auth, declared on both a web-application and its backing service)
// now surfaces one PreflightItem PER consuming component. groupPreflightItems
// is the pure dedupe helper that re-collapses those into one card.
describe("groupPreflightItems (#252 Task 15)", () => {
  const THUNDER_SPA: PreflightItem = {
    component: "web-frontend",
    dependency: "thunder-app",
    kind: "platform-resource",
    description: "End-user authentication (Thunder)",
    resourceType: "auth",
  };
  const THUNDER_SERVICE: PreflightItem = {
    component: "auth-service",
    dependency: "thunder-app",
    kind: "platform-resource",
    description: "End-user authentication (Thunder)",
    resourceType: "auth",
  };

  it("merges same-kind, same-identity entries across components into one group with the union of consumers", () => {
    const groups = groupPreflightItems([THUNDER_SPA, THUNDER_SERVICE]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.usedBy).toEqual(["auth-service", "web-frontend"]);
    expect(groups[0]!.items).toHaveLength(2);
    // Representative is deterministic (sorted by component), not "whichever
    // arrived first" — auth-service < web-frontend alphabetically.
    expect(groups[0]!.representative.component).toBe("auth-service");
  });

  it("does not merge entries with a different dependency name (different identity)", () => {
    const other: PreflightItem = {
      ...THUNDER_SPA,
      component: "billing-service",
      dependency: "postgres",
      resourceType: "postgres",
    };

    const groups = groupPreflightItems([THUNDER_SPA, other]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.usedBy.length === 1)).toBe(true);
  });

  it("does not merge entries with the same dependency name but a different kind", () => {
    const orgServiceVariant: PreflightItem = {
      component: "auth-service",
      dependency: "thunder-app",
      kind: "org-service",
      description: "Cross-project endpoint",
    };

    const groups = groupPreflightItems([THUNDER_SPA, orgServiceVariant]);

    expect(groups).toHaveLength(2);
  });

  it("does not merge platform-resource entries with the same name but a different resourceType", () => {
    const differentResourceType: PreflightItem = {
      ...THUNDER_SERVICE,
      resourceType: "session-store",
    };

    const groups = groupPreflightItems([THUNDER_SPA, differentResourceType]);

    expect(groups).toHaveLength(2);
  });

  it("merges external-config entries whose config is identical, order-independent", () => {
    const a: PreflightItem = {
      component: "web-frontend",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [
        { key: "SMTP_HOST", secret: false, defaultValue: "smtp.example.com" },
        { key: "SMTP_PASSWORD", secret: true },
      ],
    };
    const b: PreflightItem = {
      component: "auth-service",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      // Same keys, reverse order, same attributes — a genuine identical dep.
      config: [
        { key: "SMTP_PASSWORD", secret: true },
        { key: "SMTP_HOST", secret: false, defaultValue: "smtp.example.com" },
      ],
    };

    const groups = groupPreflightItems([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.usedBy).toEqual(["auth-service", "web-frontend"]);
  });

  it("does NOT merge external-config entries whose config diverges — keeps them separate (fast-follow boundary)", () => {
    const a: PreflightItem = {
      component: "web-frontend",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [{ key: "SMTP_HOST", secret: false }],
    };
    const b: PreflightItem = {
      component: "auth-service",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      // A different config key set — genuinely divergent, not the same dep.
      config: [{ key: "SMTP_ENDPOINT", secret: false }],
    };

    const groups = groupPreflightItems([a, b]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
    expect(groups.every((g) => g.usedBy.length === 1)).toBe(true);
  });
});

describe("BuildDependencyDrawer cross-component 'Used by' rendering (#252 Task 15)", () => {
  const THUNDER_SPA: PreflightItem = {
    component: "web-frontend",
    dependency: "thunder-app",
    kind: "platform-resource",
    description: "End-user authentication (Thunder)",
    resourceType: "auth",
  };
  const THUNDER_SERVICE: PreflightItem = {
    component: "auth-service",
    dependency: "thunder-app",
    kind: "platform-resource",
    description: "End-user authentication (Thunder)",
    resourceType: "auth",
  };

  it("renders a shared dependency ONCE (not once per consuming component) with a 'Used by' listing every consumer", () => {
    setup([THUNDER_SPA, THUNDER_SERVICE]);

    // The regression: before Task 15 this rendered TWICE (once per component).
    expect(screen.getAllByText("thunder-app")).toHaveLength(1);
    expect(screen.getByText("web-frontend")).toBeInTheDocument();
    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("does not render a 'Used by' line for a component-local (non-shared) dependency", () => {
    setup([
      {
        component: "checkout-api",
        dependency: "postgres",
        kind: "platform-resource",
        description: "Postgres database",
        resourceType: "postgres",
      },
    ]);

    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
  });

  it("keeps un-shared dependencies of a different kind/identity as separate cards, each with its own 'Resolve via chat'", () => {
    const ambiguousA: PreflightItem = {
      component: "checkout-api",
      dependency: "crm",
      kind: "external-ambiguous",
      description: "More than one candidate fits.",
    };
    const ambiguousB: PreflightItem = {
      component: "billing-service",
      dependency: "weather-api",
      kind: "external-unresolved",
      description: "Needs information only you can provide.",
    };
    setup([ambiguousA, ambiguousB]);

    expect(
      screen.getAllByRole("button", { name: /resolve via chat/i }),
    ).toHaveLength(2);
    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
  });

  it("a merged blocker still blocks Continue, and 'Resolve via chat' fires ONCE for the shared dependency", () => {
    const blockerA: PreflightItem = {
      component: "web-frontend",
      dependency: "crm",
      kind: "external-ambiguous",
      description: "More than one candidate fits — resolve which one to use.",
    };
    const blockerB: PreflightItem = {
      component: "auth-service",
      dependency: "crm",
      kind: "external-ambiguous",
      description: "More than one candidate fits — resolve which one to use.",
    };
    const { onResolveDependency } = setup([blockerA, blockerB]);

    // One merged card, not two.
    expect(screen.getAllByText("crm")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );

    expect(onResolveDependency).toHaveBeenCalledTimes(1);
    // Fired with the deterministic representative — proves it's ONE call for
    // the shared dep, not one per underlying consumer — and the RESOLVE
    // intent (a blocker item is never resolved).
    expect(onResolveDependency).toHaveBeenCalledWith(
      expect.objectContaining({ dependency: "crm", component: "auth-service" }),
      "resolve",
    );
  });

  it("collects an identical external-config value ONCE and fans it out to every consumer on Continue", () => {
    const a: PreflightItem = {
      component: "web-frontend",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [{ key: "SMTP_HOST", secret: false }],
    };
    const b: PreflightItem = {
      component: "auth-service",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [{ key: "SMTP_HOST", secret: false }],
    };
    const { onContinue } = setup([a, b]);

    // Exactly one input field is rendered — the merged, collect-once form.
    const fields = screen.getAllByLabelText(/SMTP_HOST/i);
    expect(fields).toHaveLength(1);
    fireEvent.change(fields[0]!, { target: { value: "smtp.shared.example.com" } });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(inputs).toHaveLength(2);
    for (const consumer of ["web-frontend", "auth-service"]) {
      const input = inputs.find((i) => i.component === consumer);
      expect(input).toMatchObject({
        component: consumer,
        dependency: "smtp-config",
        kind: "external-config",
        values: [{ key: "SMTP_HOST", value: "smtp.shared.example.com" }],
      });
    }
  });

  it("keeps divergent external-config entries as separate forms — filling one does not satisfy the other", () => {
    const a: PreflightItem = {
      component: "web-frontend",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [{ key: "SMTP_HOST", secret: false }],
    };
    const b: PreflightItem = {
      component: "auth-service",
      dependency: "smtp-config",
      kind: "external-config",
      description: "SMTP relay credentials",
      config: [{ key: "SMTP_ENDPOINT", secret: false }],
    };
    const { onContinue } = setup([a, b]);

    expect(screen.queryByText(/used by/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/SMTP_HOST/i), {
      target: { value: "smtp.web.example.com" },
    });
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/SMTP_ENDPOINT/i), {
      target: { value: "smtp.auth.example.com" },
    });
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const inputs = onContinue.mock.calls[0]?.[0] as BuildInputItem[];
    expect(inputs).toHaveLength(2);
    expect(inputs.find((i) => i.component === "web-frontend")).toMatchObject({
      values: [{ key: "SMTP_HOST", value: "smtp.web.example.com" }],
    });
    expect(inputs.find((i) => i.component === "auth-service")).toMatchObject({
      values: [{ key: "SMTP_ENDPOINT", value: "smtp.auth.example.com" }],
    });
  });
});

// #252 Task 17: state-based affordance in the drawer itself — a still
// non-resolved dependency (blocker / external-spec / org-service) keeps its
// "Resolve via chat" button; an already-resolved one (external-config,
// platform-resource) gets a hamburger → "Discuss in chat & modify" instead.
// Never both for the same dependency. org-service is always non-resolved
// here — preflight's orgServiceItems only emits a drawer item when the
// status is Unresolved/Blocked/Ambiguous
// (services/aep-api/internal/feature/build/preflight.go:221-233), matching
// how DesignView renders the same dependency (gated purely on status,
// kind-agnostic).
describe("BuildDependencyDrawer — resolved-dependency hamburger (#252 Task 17)", () => {
  it("shows a 'Resolve via chat' button for external-spec and org-service, and a hamburger for external-config/platform-resource", () => {
    setup();

    // The external-spec item ("partner-openapi-spec") and the org-service
    // item ("billing-service", never resolved) both keep the chat button —
    // only external-config/platform-resource are resolved.
    expect(
      screen.getAllByRole("button", { name: /resolve via chat/i }),
    ).toHaveLength(2);

    expect(
      screen.getByRole("button", { name: /actions for stripe-config/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /actions for postgres/i }),
    ).toBeInTheDocument();
    // Never a hamburger for the org-service or external-spec items.
    expect(
      screen.queryByRole("button", {
        name: /actions for billing-service/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /actions for partner-openapi-spec/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("never shows a hamburger for a blocker item — only its chat button", () => {
    const ambiguousItem: PreflightItem = {
      component: "checkout-api",
      dependency: "crm",
      kind: "external-ambiguous",
      description: "More than one candidate fits.",
    };
    setup([ambiguousItem]);

    expect(
      screen.getByRole("button", { name: /resolve via chat/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /actions for crm/i }),
    ).not.toBeInTheDocument();
  });

  it('hamburger → "Discuss in chat & modify" fires onResolveDependency with the item and the RECONSIDER intent', () => {
    const { onResolveDependency } = setup();

    fireEvent.click(
      screen.getByRole("button", { name: /actions for postgres/i }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /discuss in chat & modify/i }),
    );

    expect(onResolveDependency).toHaveBeenCalledTimes(1);
    expect(onResolveDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        dependency: "postgres",
        kind: "platform-resource",
      }),
      "reconsider",
    );
  });

  // The important fix (#252 Task 17 review): an org-service drawer item is
  // ALWAYS non-resolved (see the describe-block comment above), so it must
  // use the RESOLVE affordance — a "Resolve via chat" button firing the
  // "resolve" intent — never the reconsider/hamburger path a resolved
  // dependency gets.
  it("org-service item uses the RESOLVE chat affordance (button, 'resolve' intent), never reconsider/hamburger", () => {
    const orgServiceItem: PreflightItem = {
      component: "checkout-api",
      dependency: "billing-service",
      kind: "org-service",
      description: "Billing service endpoint",
    };
    const { onResolveDependency } = setup([orgServiceItem]);

    // No hamburger for org-service — only the "Resolve via chat" button.
    expect(
      screen.queryByRole("button", { name: /actions for billing-service/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /resolve via chat/i }),
    );

    expect(onResolveDependency).toHaveBeenCalledTimes(1);
    expect(onResolveDependency).toHaveBeenCalledWith(
      orgServiceItem,
      "resolve",
    );
  });

  it("without onResolveDependency wired: no hamburger and no chat button render", () => {
    render(
      <BuildDependencyDrawer
        open
        items={ITEMS}
        onClose={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /actions for/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resolve via chat/i }),
    ).not.toBeInTheDocument();
  });
});
