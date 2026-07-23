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

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CellDiagramPanel } from "./CellDiagramPanel";
import { DESIGN_CELL_PATH } from "../api/designTree";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";

// The heavy lazy renderer is irrelevant here — record what source it receives.
vi.mock("@aep/ui-cell-diagram-view", () => ({
  CellDiagramView: ({ source, emptyState }: { source?: string; emptyState?: unknown }) => (
    <div data-testid="cell-view" data-source={source ?? ""}>
      {source?.trim() ? null : <>{emptyState}</>}
    </div>
  ),
}));

// The committed-blob read (solo/offline fallback) is configured per test.
const mockContent = vi.fn();
vi.mock("../api/queries", () => ({
  useSpecFileContent: (...args: unknown[]) => mockContent(...args),
}));

const LIVE_DSL = "title Live\ncomponent api service\nsouth email-provider\n";
const COMMITTED_DSL = "title Committed\ncomponent api service\n";

const committedEntry = {
  path: DESIGN_CELL_PATH,
  sha: "abc123",
  group: "designs",
} as SpecFileEntry;

function makeCollab(ytext: Y.Text | null, agent = false): CollabSpec {
  return {
    peers: agent ? [{ kind: "agent", name: "agent" }] : [],
    getFileText: (path: string) => (path === DESIGN_CELL_PATH ? ytext : null),
  } as unknown as CollabSpec;
}

function renderPanel(collab: CollabSpec, files: SpecFileEntry[] = []) {
  return render(<CellDiagramPanel projectName="p" files={files} collab={collab} />);
}

function liveText(content: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getMap<Y.Text>("files").set(DESIGN_CELL_PATH, new Y.Text());
  ytext.insert(0, content);
  return ytext;
}

beforeEach(() => {
  mockContent.mockReset();
  mockContent.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe("CellDiagramPanel — design.cell is the single source", () => {
  it("renders the live collab design.cell when connected, and grows with it", () => {
    const ytext = liveText(LIVE_DSL);
    renderPanel(makeCollab(ytext), [committedEntry]);

    expect(screen.getByTestId("cell-view").dataset.source).toBe(LIVE_DSL);
    // The REST fallback stays disabled while the doc supplies the text.
    expect(mockContent).toHaveBeenLastCalledWith("p", null);

    act(() => {
      ytext.insert(ytext.length, "api -> email-provider\n");
    });
    expect(screen.getByTestId("cell-view").dataset.source).toContain("api -> email-provider");
  });

  it("falls back to the committed design.cell blob when the doc has no text (solo/offline)", () => {
    mockContent.mockReturnValue({
      data: { content: COMMITTED_DSL, sha: "abc123" },
      isPending: false,
      isError: false,
    });
    renderPanel(makeCollab(null), [committedEntry]);

    expect(mockContent).toHaveBeenLastCalledWith("p", committedEntry);
    expect(screen.getByTestId("cell-view").dataset.source).toBe(COMMITTED_DSL);
  });

  it("shows a spinner while the committed blob loads", () => {
    mockContent.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderPanel(makeCollab(null), [committedEntry]);

    expect(screen.getByLabelText("Loading architecture diagram")).toBeInTheDocument();
  });

  it("surfaces a committed-blob read failure", () => {
    mockContent.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPanel(makeCollab(null), [committedEntry]);

    expect(
      screen.getByText(/failed to load the architecture diagram source/i),
    ).toBeInTheDocument();
  });

  it("shows the waiting state while an agent turn runs and design.cell has no content yet", () => {
    renderPanel(makeCollab(null, true), []);

    expect(screen.getByText(/waiting for the agent/i)).toBeInTheDocument();
  });

  it("badges the pane with Designing… only while an agent turn runs", () => {
    renderPanel(makeCollab(liveText(LIVE_DSL), true), []);
    expect(screen.getByText("Designing…")).toBeInTheDocument();
  });

  it("shows no badge without an agent peer", () => {
    renderPanel(makeCollab(liveText(LIVE_DSL), false), []);
    expect(screen.queryByText("Designing…")).not.toBeInTheDocument();
  });
});
