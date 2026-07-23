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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";
import { SpecView } from "./SpecView";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];
type BuildResponse = components["schemas"]["BuildResponse"];

// --- Router -----------------------------------------------------------
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({}),
}));

// --- oxygen-ui: only useAppShell needs a stub (it throws outside an
// <AppShell> provider); every other export passes through untouched. -----
vi.mock("@wso2/oxygen-ui", async () => {
  const actual =
    await vi.importActual<typeof import("@wso2/oxygen-ui")>("@wso2/oxygen-ui");
  return {
    ...actual,
    useAppShell: () => ({
      actions: { collapseSidebar: vi.fn(), expandSidebar: vi.fn() },
    }),
  };
});

// --- Collab room: solo/offline-shaped stub (status "offline" exercises the
// header's "solo session" metadata text — see the metadata-line test below);
// flush is the only call SpecView awaits, so it's the only piece most tests
// need to configure. --
const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock("../collab/useCollabSpec", () => ({
  useCollabSpec: () => ({
    status: "offline",
    peers: [],
    getFileText: () => null,
    getFileFragment: () => null,
    docPaths: [],
    provider: null,
    self: { name: "You", color: "#000000" },
    isLocalTransaction: () => false,
    version: 0,
    flush: mockFlush,
  }),
}));

vi.mock("../../../auth/SessionContext", () => ({
  useSession: () => ({
    user: { name: "Test User", email: "test@example.com" },
    orgHandle: "acme",
    signOut: vi.fn(),
  }),
}));

// --- Project/spec queries: replaced wholesale so the test needs neither a
// QueryClientProvider nor MSW — only the Build routing under test is real. -
const mockMutateAsync = vi.fn();
const mockPreflightRefetch = vi.fn();
vi.mock("../../projects/api/queries", () => ({
  useProject: () => ({ data: { displayName: "Test Project" } }),
  useProjectStatus: () => ({ data: { specStatus: "approved" } }),
  useProjectTags: () => ({ data: { latest: "v1", specDirty: false } }),
  useBuildProject: () => ({ mutateAsync: mockMutateAsync }),
  useBuildPreflight: () => ({ refetch: mockPreflightRefetch }),
}));

// Cost visibility (#245): stubbed like the other data hooks — no spend — so
// the chip renders nothing and Build routing stays the subject.
vi.mock("../../usage/api/queries", () => ({
  useProjectUsage: () => ({ data: undefined, isPending: true, isError: false }),
}));

vi.mock("../api/queries", () => ({
  useSpecFiles: () => ({
    data: [{ path: "specs/design/overview.md", sha: "abc", group: "designs" }],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSpecFileContent: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// --- BuildDependencyDrawer: its own behavior is covered by
// BuildDependencyDrawer.test.tsx, so here it's a thin stub that exposes
// Continue/Cancel so tests can drive SpecView's routing without re-deriving
// real dependency-form state. ------------------------------------------
const STUB_INPUTS: BuildInputItem[] = [
  { component: "checkout-api", dependency: "postgres", kind: "platform-resource", approved: true },
];
vi.mock("./BuildDependencyDrawer", () => ({
  BuildDependencyDrawer: ({
    open,
    onClose,
    onContinue,
  }: {
    open: boolean;
    items: PreflightItem[];
    onClose: () => void;
    onContinue: (inputs: BuildInputItem[]) => void;
  }) =>
    open ? (
      <div data-testid="dependency-drawer">
        <button onClick={() => onContinue(STUB_INPUTS)}>Drawer Continue</button>
        <button onClick={onClose}>Drawer Cancel</button>
      </div>
    ) : null,
}));

const PREFLIGHT_ITEMS: PreflightItem[] = [
  {
    component: "checkout-api",
    dependency: "postgres",
    kind: "platform-resource",
    description: "Postgres database",
    resourceType: "postgres",
  },
];

function clickBuild() {
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
}

describe("SpecView onBuild routing (#164)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlush.mockResolvedValue(undefined);
  });

  it("needsInput:false — builds immediately with empty inputs and navigates, no drawer", async () => {
    mockPreflightRefetch.mockResolvedValue({ data: { needsInput: false, items: [] } });
    mockMutateAsync.mockResolvedValue({ tag: "v1" } satisfies BuildResponse);

    render(<SpecView projectName="proj1" />);
    clickBuild();

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ inputs: [] }),
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/projects/$projectName",
      params: { projectName: "proj1" },
    });
    expect(screen.queryByTestId("dependency-drawer")).not.toBeInTheDocument();
  });

  it("preflight refetch errors — surfaces the failure and does not build or navigate", async () => {
    mockPreflightRefetch.mockResolvedValue({
      data: undefined,
      isError: true,
      error: new Error("boom"),
    });

    render(<SpecView projectName="proj1" />);
    clickBuild();

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dependency-drawer")).not.toBeInTheDocument();
  });

  it("needsInput:true — opens the dependency drawer and does not build", async () => {
    mockPreflightRefetch.mockResolvedValue({
      data: { needsInput: true, items: PREFLIGHT_ITEMS },
    });

    render(<SpecView projectName="proj1" />);
    clickBuild();

    await waitFor(() =>
      expect(screen.getByTestId("dependency-drawer")).toBeInTheDocument(),
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("drawer Continue with a clean BuildResponse — builds with the drawer's inputs, closes, navigates", async () => {
    mockPreflightRefetch.mockResolvedValue({
      data: { needsInput: true, items: PREFLIGHT_ITEMS },
    });
    mockMutateAsync.mockResolvedValue({ tag: "v2" } satisfies BuildResponse);

    render(<SpecView projectName="proj1" />);
    clickBuild();
    await waitFor(() =>
      expect(screen.getByTestId("dependency-drawer")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Drawer Continue"));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ inputs: STUB_INPUTS }),
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/projects/$projectName",
      params: { projectName: "proj1" },
    });
    expect(screen.queryByTestId("dependency-drawer")).not.toBeInTheDocument();
  });

  it("drawer Continue with failures — keeps the drawer open and surfaces the failure reasons", async () => {
    mockPreflightRefetch.mockResolvedValue({
      data: { needsInput: true, items: PREFLIGHT_ITEMS },
    });
    mockMutateAsync.mockResolvedValue({
      failures: [{ dependency: "postgres", reason: "provisioning timed out" }],
    } satisfies BuildResponse);

    render(<SpecView projectName="proj1" />);
    clickBuild();
    await waitFor(() =>
      expect(screen.getByTestId("dependency-drawer")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Drawer Continue"));

    await waitFor(() =>
      expect(
        screen.getByText(/postgres: provisioning timed out/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("dependency-drawer")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("SpecView header metadata (soft version chips)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlush.mockResolvedValue(undefined);
  });

  it("renders session/version info as soft status chips (not buttons) and drops 'Approved'", () => {
    render(<SpecView projectName="proj1" />);

    // Version + session state render as soft status chips beside the title
    // (consistent with the builds/deployments headers): "v1 · published"
    // (tags.latest) and "solo session" (offline collab).
    expect(screen.getByText("v1 · published")).toBeInTheDocument();
    expect(screen.getByText("solo session")).toBeInTheDocument();

    // The old "Approved" status chip is gone entirely (specStatus is
    // "approved" in this test's project-status mock).
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();

    // Build remains the header's only button-like control — the soft chips
    // are Chips, not buttons.
    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /solo|published/i }),
    ).not.toBeInTheDocument();
  });
});
