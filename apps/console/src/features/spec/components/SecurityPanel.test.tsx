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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ProjectRoleState,
  ProjectRolesLiveState,
  ProjectTestUserState,
} from "../api/roles";
import { serializeSecurityDesign, type SecurityDesign } from "../api/securityDesign";
import { SecurityPanel } from "./SecurityPanel";

afterEach(cleanup);

function role(name: string): SecurityDesign["roles"][number] {
  return {
    name,
    description: `What ${name} may do`,
    stories: [1],
    grantedBy: "an administrator",
    permissions: [{ component: "orders-api", actions: ["read"] }],
  };
}

function design(over: Partial<SecurityDesign> = {}): string {
  return serializeSecurityDesign({
    version: 1,
    coldStartRole: null,
    publicComponents: [],
    roles: [role("Admin")],
    testUsers: [],
    thunder: { name: "orders-app", type: "browser" },
    ...over,
  });
}

function liveRole(
  name: string,
  over: Partial<ProjectRoleState> = {},
): ProjectRoleState {
  return { name, platformCreated: true, ...over };
}

function liveUser(
  username: string,
  over: Partial<ProjectTestUserState> = {},
): ProjectTestUserState {
  return {
    username,
    roleName: "Admin",
    coldStart: false,
    exists: true,
    owned: true,
    supplied: false,
    ...over,
  };
}

function live(
  over: Partial<ProjectRolesLiveState> = {},
): ProjectRolesLiveState {
  return { directoryAvailable: true, roles: [], testUsers: [], ...over };
}

function setup(props: Partial<React.ComponentProps<typeof SecurityPanel>> = {}) {
  render(
    <SecurityPanel securityJson={design()} live={undefined} {...props} />,
  );
}

describe("SecurityPanel — one read-only page", () => {
  it("has no tabs; Roles & users is a heading", () => {
    setup();

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Security architecture" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Roles & users" }),
    ).toBeInTheDocument();
  });

  it("shows no Reveal / Rotate / Delete / Add / Hide controls", () => {
    setup({
      securityJson: design({ testUsers: [{ username: "ada", role: "Admin" }] }),
      live: live({ testUsers: [liveUser("ada")] }),
    });

    for (const name of [
      /Reveal/i,
      /Rotate/i,
      /^Delete$/i,
      /Add a test user/i,
      /^Hide$/i,
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("correct-horse")).not.toBeInTheDocument();
  });
});

describe("SecurityPanel — reading the document", () => {
  it("shows a spinner while the committed document is loading, not the empty copy", () => {
    setup({ securityJson: null, isPending: true });

    expect(screen.getByLabelText("Loading security")).toBeInTheDocument();
    expect(
      screen.queryByText(/This Security document is empty or incomplete/i),
    ).not.toBeInTheDocument();
  });

  it("surfaces a committed-document read failure", () => {
    setup({ securityJson: null, isError: true });

    expect(
      screen.getByText(/Failed to load the Security document/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This Security document is empty or incomplete/i),
    ).not.toBeInTheDocument();
  });

  it("explains an empty or null document with the mock info copy", () => {
    setup({ securityJson: null });

    expect(
      screen.getByText(
        /This Security document is empty or incomplete\. Ask in chat — the design agent can finish it\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Disposable accounts for agents, not for real people/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("explains an empty JSON object with the same info copy", () => {
    setup({ securityJson: "{}" });

    expect(
      screen.getByText(
        /This Security document is empty or incomplete\. Ask in chat — the design agent can finish it\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Disposable accounts for agents, not for real people/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("shows a malformed document as an error with the Security prefix", () => {
    setup({ securityJson: '{"version": 1,' });

    expect(
      screen.getByText(/Couldn't read the Security document:/i),
    ).toBeInTheDocument();
  });

  it("renders thunder with platform-default scopes when scopes are omitted", () => {
    setup();

    expect(screen.getByText("orders-app")).toBeInTheDocument();
    expect(screen.getByText("Type: browser")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Scopes: platform default (openid profile email group ou)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /People sign in through this Thunder application\. The platform creates it at Build/,
      ),
    ).toBeInTheDocument();
  });

  it("renders thunder scopes when the document sets them", () => {
    setup({
      securityJson: design({
        thunder: {
          name: "orders-app",
          type: "browser",
          scopes: "openid profile email group ou",
        },
      }),
    });

    expect(
      screen.getByText("Scopes: openid profile email group ou"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Scopes: platform default (openid profile email group ou)",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders each role with description, Granted by, permissions, and usernames", () => {
    setup({
      securityJson: design({
        roles: [role("Admin"), role("Viewer")],
        testUsers: [{ username: "ada", role: "Admin" }],
      }),
    });

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.getByText("What Admin may do")).toBeInTheDocument();
    expect(screen.getAllByText(/Granted by an administrator/)).toHaveLength(2);
    expect(screen.getAllByText("orders-api")).toHaveLength(2);
    expect(screen.getByText("ada")).toBeInTheDocument();
  });

  it("shows the Security heading and subtitle", () => {
    setup();

    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Who can sign in, what each role may do, and the Thunder application that issues the session\./,
      ),
    ).toBeInTheDocument();
  });
});

describe("SecurityPanel — a role against the shared directory", () => {
  it('reads "Reused" for a role the platform already created', () => {
    setup({ live: live({ roles: [liveRole("Admin")] }) });

    expect(screen.getByText("Reused")).toBeInTheDocument();
  });

  it('reads "New at Build" for a role the directory does not have', () => {
    setup({ live: live({ roles: [liveRole("Something Else")] }) });

    expect(screen.getByText("New at Build")).toBeInTheDocument();
  });

  it('reads "Not ours" with the mock leave-alone tooltip', async () => {
    setup({
      live: live({ roles: [liveRole("Admin", { platformCreated: false })] }),
    });

    const chip = screen.getByText("Not ours");
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText("Reused")).not.toBeInTheDocument();

    fireEvent.mouseOver(chip);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      /This group already exists and the platform did not create it, so it will be left alone\./,
    );
    expect(tooltip.textContent).not.toMatch(/no test user is added/i);
  });

  it("matches the design's role to the directory's case-insensitively", () => {
    setup({ live: live({ roles: [liveRole("admin")] }) });

    expect(screen.getByText("Reused")).toBeInTheDocument();
  });

  it("omits live chips when the directory is unreachable — no IDP alert", () => {
    setup({
      live: live({
        directoryAvailable: false,
        roles: [liveRole("Admin", { platformCreated: false })],
      }),
    });

    expect(
      screen.queryByText(/identity provider could not be reached/i),
    ).not.toBeInTheDocument();
    for (const label of ["Reused", "New at Build", "Not ours"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("omits live chips when live is missing", () => {
    setup({ live: undefined });

    for (const label of ["Reused", "New at Build", "Not ours"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});

describe("SecurityPanel — disposable accounts warning", () => {
  it("uses the mock Deploy body, once however many roles", () => {
    setup({
      securityJson: design({
        roles: [role("Admin"), role("Viewer"), role("Auditor")],
        testUsers: [
          { username: "ada", role: "Admin" },
          { username: "grace", role: "Admin" },
          { username: "linus", role: "Viewer" },
        ],
      }),
    });

    expect(
      screen.getAllByText(
        /Disposable accounts for agents, not for real people/i,
      ),
    ).toHaveLength(1);

    const warning = screen.getByText(
      /Disposable accounts for agents, not for real people/i,
    );
    const body = warning.parentElement!;
    expect(body).toHaveTextContent(
      /passwords are shown on Deploy after Build publishes them/i,
    );
    expect(body).toHaveTextContent(/never name a real person/i);
    expect(body).not.toHaveTextContent(/roles gate ticket/i);
  });

  it("says nothing about test users when the design is empty", () => {
    setup({ securityJson: null });

    expect(
      screen.queryByText(
        /Disposable accounts for agents, not for real people/i,
      ),
    ).not.toBeInTheDocument();
  });
});

describe("SecurityPanel — test users", () => {
  it("shows the name the build will supply for a role the design gave none", () => {
    setup({ securityJson: design({ roles: [role("Compliance Admin")] }) });

    expect(screen.getByText("test-compliance-admin")).toBeInTheDocument();
    expect(screen.getByText("Platform-supplied")).toBeInTheDocument();
  });

  it("does not badge an authored user as platform-supplied", () => {
    setup({
      securityJson: design({ testUsers: [{ username: "ada", role: "Admin" }] }),
    });

    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.queryByText("Platform-supplied")).not.toBeInTheDocument();
  });

  it("does not show Name already taken or Created at Build chips", () => {
    setup({
      securityJson: design({ testUsers: [{ username: "ada", role: "Admin" }] }),
      live: live({
        testUsers: [
          liveUser("ada", { owned: false }),
          liveUser("grace", { exists: false, username: "grace" }),
        ],
      }),
    });

    expect(screen.queryByText("Name already taken")).not.toBeInTheDocument();
    expect(screen.queryByText("Created at Build")).not.toBeInTheDocument();
  });
});

describe("SecurityPanel — the document's standing rules", () => {
  it("names the role a freshly signed-in person holds", () => {
    setup({ securityJson: design({ coldStartRole: "Admin" }) });

    expect(
      screen.getByText(/has just signed in and been granted nothing holds/i),
    ).toBeInTheDocument();
  });

  it("says a person with no role reaches nothing when there is no cold-start role", () => {
    setup({ securityJson: design({ coldStartRole: null }) });

    expect(screen.getByText(/reaches nothing/i)).toBeInTheDocument();
  });

  it("lists the components open without sign-in", () => {
    setup({ securityJson: design({ publicComponents: ["docs-site"] }) });

    expect(
      screen.getByText(/Open to everyone, no sign-in: docs-site\./i),
    ).toBeInTheDocument();
  });
});
