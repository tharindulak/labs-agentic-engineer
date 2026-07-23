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
import type { CustomLayout } from "@aep/ui-cell-diagram-react";
import CellDiagramInner from "./CellDiagramInner";

// The renderer itself is exercised in @aep/ui-cell-diagram-react; here only
// the theme and layout-persistence wiring matters, so record the props it
// receives and expose the layout-change callback. The fingerprint stub keeps
// match/mismatch under test control.
let lastLayoutChange: ((layout: CustomLayout) => void) | undefined;
vi.mock("@aep/ui-cell-diagram-react", () => ({
  fingerprintSource: (source: string) => `fp:${source}`,
  CellDiagram: ({
    source,
    theme,
    tolerant,
    customLayout,
    onCustomLayoutChange,
  }: {
    source: string;
    theme?: string;
    tolerant?: boolean;
    customLayout?: CustomLayout | null;
    onCustomLayoutChange?: (layout: CustomLayout) => void;
  }) => {
    lastLayoutChange = onCustomLayoutChange;
    return (
      <div
        data-testid="cell-diagram"
        data-source={source}
        data-theme={theme}
        data-tolerant={String(tolerant)}
        data-layout={customLayout ? JSON.stringify(customLayout.nodes) : "none"}
      />
    );
  },
}));

// Color-scheme hooks are stubbed per test: MUI's useColorScheme is the live
// signal (ColorSchemeToggle drives it), palette.mode the static fallback.
const mockColorScheme = vi.fn();
const mockPaletteMode = vi.fn();
vi.mock("@wso2/oxygen-ui", () => ({
  useColorScheme: () => mockColorScheme(),
  useTheme: () => ({ palette: { mode: mockPaletteMode() } }),
}));

const STORAGE_KEY = "aep.cell-diagram.layout:proj1";

function layoutFor(source: string): CustomLayout {
  return {
    version: 1,
    sourceFingerprint: `fp:${source}`,
    nodes: { api: { kind: "component", cellId: "main", x: 10, y: 20 } },
  } as CustomLayout;
}

beforeEach(() => {
  mockColorScheme.mockReturnValue({ mode: "light", systemMode: undefined });
  mockPaletteMode.mockReturnValue("light");
  lastLayoutChange = undefined;
  window.localStorage.clear();
});

describe("CellDiagramInner theme wiring", () => {
  it("passes the source with tolerant compile and the active light scheme", () => {
    render(<CellDiagramInner source="title X\n" />);
    const el = screen.getByTestId("cell-diagram");
    expect(el.dataset.source).toBe("title X\\n");
    expect(el.dataset.tolerant).toBe("true");
    expect(el.dataset.theme).toBe("light");
  });

  it("follows an explicit dark scheme", () => {
    mockColorScheme.mockReturnValue({ mode: "dark", systemMode: undefined });
    render(<CellDiagramInner source="title X" />);
    expect(screen.getByTestId("cell-diagram").dataset.theme).toBe("dark");
  });

  it("resolves the system scheme through systemMode", () => {
    mockColorScheme.mockReturnValue({ mode: "system", systemMode: "dark" });
    render(<CellDiagramInner source="title X" />);
    expect(screen.getByTestId("cell-diagram").dataset.theme).toBe("dark");
  });

  it("falls back to palette.mode when no color-scheme context is available", () => {
    mockColorScheme.mockReturnValue({ mode: undefined, systemMode: undefined });
    mockPaletteMode.mockReturnValue("dark");
    render(<CellDiagramInner source="title X" />);
    expect(screen.getByTestId("cell-diagram").dataset.theme).toBe("dark");
  });
});

describe("CellDiagramInner dragged-layout persistence", () => {
  it("holds an emitted layout so a dragged node does not snap back, and stores it per key", () => {
    render(<CellDiagramInner source="title X" layoutKey="proj1" />);
    expect(screen.getByTestId("cell-diagram").dataset.layout).toBe("none");

    act(() => lastLayoutChange?.(layoutFor("title X")));

    expect(screen.getByTestId("cell-diagram").dataset.layout).toContain("api");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").sourceFingerprint).toBe(
      "fp:title X",
    );
  });

  it("restores a stored layout for the same key and source", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutFor("title X")));
    render(<CellDiagramInner source="title X" layoutKey="proj1" />);
    expect(screen.getByTestId("cell-diagram").dataset.layout).toContain("api");
  });

  it("resets and removes the stored layout when the DSL changes", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutFor("title X")));
    render(<CellDiagramInner source="title CHANGED" layoutKey="proj1" />);

    expect(screen.getByTestId("cell-diagram").dataset.layout).toBe("none");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps dragged positions in memory only without a layoutKey", () => {
    render(<CellDiagramInner source="title X" />);

    act(() => lastLayoutChange?.(layoutFor("title X")));

    expect(screen.getByTestId("cell-diagram").dataset.layout).toContain("api");
    expect(window.localStorage.length).toBe(0);
  });
});
