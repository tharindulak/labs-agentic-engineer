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
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PublishedTestUser } from "../lib/publishedTestUsers";
import { SignInPanel } from "./SignInPanel";

const THUNDER_URL = "http://localhost:8097";
const THUNDER_CONSOLE_USERS = "http://localhost:8097/console/users";
const MOCK_PASSWORD = "mocknotreal";

function renderPanel(
  over: {
    logins?: readonly PublishedTestUser[];
    revealPassword?: (username: string) => Promise<string>;
    loadState?: "ready" | "pending" | "error";
  } = {},
): {
  revealPassword: ReturnType<typeof vi.fn<(username: string) => Promise<string>>>;
} {
  const revealPassword =
    over.revealPassword ??
    vi.fn(async () => MOCK_PASSWORD);
  const ui: ReactElement = (
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <SignInPanel
        logins={over.logins ?? []}
        thunderUrl={THUNDER_URL}
        revealPassword={revealPassword}
        {...(over.loadState !== undefined ? { loadState: over.loadState } : {})}
      />
    </OxygenUIThemeProvider>
  );
  render(ui);
  return { revealPassword: revealPassword as ReturnType<typeof vi.fn<(username: string) => Promise<string>>> };
}

describe("SignInPanel", () => {
  it("empty logins shows only the Thunder sentence", () => {
    renderPanel({ logins: [] });

    expect(
      screen.getByText(/Manage user accounts in/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Test users for agents on this environment"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/test-/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reveal/i }),
    ).not.toBeInTheDocument();

    const link = screen.getByRole("link", {
      name: "Open Thunder Console to add or remove real accounts",
    });
    expect(link).toHaveAttribute("href", THUNDER_CONSOLE_USERS);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("one owned login shows caption, username, and Thunder sentence", () => {
    renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
      ],
    });

    expect(
      screen.getByText("Test users for agents on this environment"),
    ).toBeInTheDocument();
    expect(screen.getByText("test-viewer")).toBeInTheDocument();
    expect(
      screen.getByText(/Manage user accounts in/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Test users/)).toHaveTextContent(
      "Test users for agents on this environment",
    );
    expect(screen.queryByText(/Test users/)).not.toHaveTextContent(
      /user accounts/,
    );
  });

  it("reveal then hide cycles password visibility for one login", async () => {
    const { revealPassword } = renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    );
    expect(revealPassword).toHaveBeenCalledWith("test-viewer");

    await waitFor(() => {
      expect(screen.getByText(MOCK_PASSWORD)).toBeInTheDocument();
    });
    expect(screen.getByText(MOCK_PASSWORD)).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(
      screen.queryByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(MOCK_PASSWORD)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    ).toBeInTheDocument();
  });

  it("revealing one of two logins does not reveal the other", async () => {
    renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
        {
          username: "test-compliance-admin",
          role: "Compliance Admin",
          coldStart: false,
        },
      ],
    });

    expect(screen.getByText("test-viewer")).toBeInTheDocument();
    expect(screen.getByText("test-compliance-admin")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(MOCK_PASSWORD)).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", {
        name: "Reveal the password for test-compliance-admin",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Hide",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByText(MOCK_PASSWORD),
    ).toHaveLength(1);
  });

  it("shows an error caption when revealPassword rejects", async () => {
    renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
      ],
      revealPassword: vi.fn(async () => {
        throw new Error("sealed store unreachable");
      }),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("sealed store unreachable")).toBeInTheDocument();
    });
    expect(screen.queryByText(MOCK_PASSWORD)).not.toBeInTheDocument();
  });

  it("does not render Add, Rotate, Delete, or Roles-gate copy", () => {
    renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
      ],
    });

    expect(screen.queryByText(/^Add$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rotate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Delete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Roles gate/i)).not.toBeInTheDocument();
  });

  it("role tooltip shows cold-start suffix or bare role name", async () => {
    renderPanel({
      logins: [
        { username: "test-viewer", role: "Viewer", coldStart: true },
        {
          username: "test-compliance-admin",
          role: "Compliance Admin",
          coldStart: false,
        },
      ],
    });

    const coldStartUsername = screen.getByText("test-viewer");
    fireEvent.mouseOver(coldStartUsername);
    const coldTooltip = await screen.findByRole("tooltip");
    expect(coldTooltip).toHaveTextContent("Viewer · cold start");
    fireEvent.mouseLeave(coldStartUsername);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    const roleUsername = screen.getByText("test-compliance-admin");
    fireEvent.mouseOver(roleUsername);
    const roleTooltip = await screen.findByRole("tooltip");
    expect(roleTooltip).toHaveTextContent("Compliance Admin");
    expect(roleTooltip.textContent).toBe("Compliance Admin");
  });

  it("pending load shows a caption and still links Thunder Console", () => {
    renderPanel({ loadState: "pending" });
    expect(screen.getByText("Loading test users…")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Open Thunder Console to add or remove real accounts",
      }),
    ).toBeInTheDocument();
  });

  it("error load shows a caption and still links Thunder Console", () => {
    renderPanel({ loadState: "error" });
    expect(screen.getByText("Couldn't load test users.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Open Thunder Console to add or remove real accounts",
      }),
    ).toBeInTheDocument();
  });

  it("shows an error caption when clipboard write rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPanel({
      logins: [{ username: "test-viewer", role: "Viewer", coldStart: true }],
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reveal the password for test-viewer",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(MOCK_PASSWORD)).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy the password for test-viewer",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("clipboard denied")).toBeInTheDocument();
    });
  });
});
