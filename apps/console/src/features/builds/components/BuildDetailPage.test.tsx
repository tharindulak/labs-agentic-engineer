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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type BuildSummary = components["schemas"]["BuildSummary"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];

// Router stubbed to plain anchors — no RouterProvider needed.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  createLink:
    (Component: React.ElementType) =>
    ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children?: React.ReactNode;
    }) => {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [k, v]) => acc.replace(`$${k}`, v),
        to,
      );
      return (
        <Component {...rest} component="a" href={path}>
          {children}
        </Component>
      );
    },
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

// The coding agent's stream is its own tested surface and needs a live run to
// say anything; the build page only decides WHETHER to mount it.
vi.mock("./RunFeed", () => ({
  RunFeed: () => <div>run feed</div>,
}));

vi.mock("../../tasks/api/queries", () => ({
  useAllTasks: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// The external-resources section's two reads. Both are stubbed here rather
// than in the section's own mocks because this page mounts it FOR REAL — that
// is the only way this suite can prove where it sits on the page.
let mockReadiness:
  | components["schemas"]["ProjectDependencyReadiness"]
  | undefined;
vi.mock("../../projects/api/queries", () => ({
  useProjectStatus: () => ({
    data: { repoUrl: "https://github.com/acme/demo.git" },
  }),
  useProjectDependencyReadiness: () => ({
    data: mockReadiness,
    isPending: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSaveConnectionValues: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

let mockDesignDeps: components["schemas"]["ComponentDependencies"][] = [];
vi.mock("../../spec/api/queries", () => ({
  useDesignDependencies: () => ({
    data: mockDesignDeps,
    isPending: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

let mockBuilds: BuildSummary[] = [];
let mockRuns: MilestoneRunView[] = [];
vi.mock("../api/queries", () => ({
  useBuilds: () => ({
    data: mockBuilds,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useBuildRuns: () => ({ data: { runs: mockRuns } }),
  useCycleBuilds: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCancelRun: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { BuildDetailPage } from "./BuildDetailPage";

const build = (over: Partial<BuildSummary> = {}): BuildSummary => ({
  tag: "v2",
  milestoneNumber: 2,
  status: "in_progress",
  startedAt: "2026-08-14T16:20:00Z",
  ...over,
});

const run = (over: Partial<MilestoneRunView> = {}): MilestoneRunView =>
  ({
    id: "run-1",
    milestoneNumber: 2,
    milestoneTitle: "v2",
    kind: "dev",
    origin: "spec-build",
    state: "running",
    budgets: {
      cyclesTotal: 1,
      cycleCeiling: 8,
      fixCycles: 0,
      conflictCycles: 0,
      buildRetriggers: 0,
      validationCycles: 0,
    },
    validation: {},
    cycles: [{ id: "cycle-1", kind: "coding", state: "running" }],
    createdAt: "2026-08-14T16:20:00Z",
    ...over,
  }) as MilestoneRunView;

const renderPage = () =>
  render(<BuildDetailPage projectName="demo-shop" tag="v2" />);

const withOneExternal = () => {
  mockDesignDeps = [
    {
      componentName: "catalog-api",
      dependencies: [
        { kind: "external", name: "stripe", config: [{ key: "api_key" }] },
      ],
    },
  ] as components["schemas"]["ComponentDependencies"][];
  mockReadiness = {
    configured: false,
    dependencies: [
      { name: "stripe", state: "unset", missingKeys: ["api_key"] },
    ],
  } as components["schemas"]["ProjectDependencyReadiness"];
};

afterEach(() => {
  mockBuilds = [];
  mockRuns = [];
  mockDesignDeps = [];
  mockReadiness = undefined;
  vi.clearAllMocks();
});

// ADR-0023 moved the collection of external values off the Build button and
// onto the run. ADR-0021 then made a VERSION's page the place that says why
// that version is or is not moving, so this is where the section lives.
describe("BuildDetailPage — external resources", () => {
  it("offers the values as a peer of Tasks, ahead of the logs", () => {
    mockBuilds = [build()];
    mockRuns = [run()];
    withOneExternal();
    renderPage();

    expect(screen.getByText("External resources")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 need values")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Configure stripe" }),
    ).toBeInTheDocument();

    // ORDER, not membership. It is outstanding work a person must do, so it is
    // a peer of a task row — after Tasks, and before the two log sections,
    // which are a record rather than a request.
    // Addressed by each section's disclosure control: "Tasks" is also a cell
    // label on the summary card, and the heading text alone is ambiguous.
    const section = (title: string) =>
      screen.getByRole("button", { name: `Collapse ${title}` });
    const tasks = section("Tasks");
    const external = section("External resources");
    const agentLog = section("Coding agent log");
    expect(
      tasks.compareDocumentPosition(external) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      external.compareDocumentPosition(agentLog) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing when the design declares no external dependencies", () => {
    mockBuilds = [build()];
    mockRuns = [run()];
    mockReadiness = {
      configured: true,
      dependencies: [],
    } as components["schemas"]["ProjectDependencyReadiness"];
    renderPage();

    expect(screen.queryByText("External resources")).not.toBeInTheDocument();
  });
});

// A run parked at the deploy gate is UNBOUNDED and only a person can end it,
// so `waiting` with nothing beside it reads as a hang.
describe("BuildDetailPage — the deploy gate's park", () => {
  const parked = (deps?: string[]) =>
    run({
      state: "waiting",
      waitingReason: "external-values",
      ...(deps ? { blockingDependencies: deps } : {}),
    });

  it("names the blocking dependencies and points at the section below", () => {
    mockBuilds = [build()];
    mockRuns = [parked(["stripe", "sendgrid"])];
    withOneExternal();
    renderPage();

    expect(
      screen.getByText("Waiting for values: stripe, sendgrid"),
    ).toBeInTheDocument();
    // The promise the reader needs most: there is no restart button to hunt for.
    expect(
      screen.getByText(/the run resumes and deploys on its own/),
    ).toBeInTheDocument();
    // On THIS page, deliberately — a route would be a second way into one
    // configuration surface.
    expect(screen.getByRole("link", { name: "Supply values" })).toHaveAttribute(
      "href",
      "#external-resources",
    );
  });

  // An older run row, or a lost write, carries no names. That park still has to
  // be explainable.
  it("still explains a park that names nothing", () => {
    mockBuilds = [build()];
    mockRuns = [parked()];
    renderPage();

    expect(screen.getByText("Waiting for external values")).toBeInTheDocument();
  });

  // The regression this exists to stop. `BuildSummary` has no waiting reason,
  // so the ledger's derivation calls a parked run "Running · Coding agent" —
  // true of the ledger, which cannot afford the run read, and a lie on the one
  // page that already has it.
  it("does not claim the coding agent is working while the run is parked", () => {
    mockBuilds = [build()];
    mockRuns = [parked(["stripe"])];
    renderPage();

    expect(screen.getByText("Waiting for values")).toBeInTheDocument();
    expect(screen.queryByText("Running · Coding agent")).not.toBeInTheDocument();
    // And the rollout line must not contradict the notice above it.
    expect(
      screen.getByText("v2 is built and waiting for its external values."),
    ).toBeInTheDocument();
  });

  it("says nothing about a park on a run that is not parked", () => {
    mockBuilds = [build()];
    mockRuns = [run()];
    renderPage();

    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
    expect(screen.getByText("Running · Coding agent")).toBeInTheDocument();
  });
});
