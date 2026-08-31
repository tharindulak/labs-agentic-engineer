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

// Lazy-loaded leaf: keeps the renderer's heavy transitive deps (@xyflow,
// dagre) and its stylesheet out of the main bundle until the diagram is
// actually shown. The component self-imports its CSS, so no separate
// stylesheet import is needed here. `tolerant` lets a still-growing
// `design.cell` render its partial diagram instead of the error placeholder.
import { useCallback, useEffect, useState } from "react";
import {
  CellDiagram,
  fingerprintSource,
  type CustomLayout,
  type DiagramTheme,
} from "@aep/ui-cell-diagram-react";
import { useColorScheme, useTheme } from "@wso2/oxygen-ui";

const STORAGE_PREFIX = "aep.cell-diagram.layout:";

// localStorage can be absent or throwing (privacy modes); dragged positions
// then simply live in memory for the mounted diagram.
function readStoredLayout(layoutKey: string | undefined): CustomLayout | null {
  if (!layoutKey) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + layoutKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomLayout;
    return parsed?.version === 1 && typeof parsed.sourceFingerprint === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredLayout(layoutKey: string | undefined, layout: CustomLayout | null): void {
  if (!layoutKey) return;
  try {
    if (layout) window.localStorage.setItem(STORAGE_PREFIX + layoutKey, JSON.stringify(layout));
    else window.localStorage.removeItem(STORAGE_PREFIX + layoutKey);
  } catch {
    /* memory-only */
  }
}

export default function CellDiagramInner({
  source,
  layoutKey,
  compact,
  readOnly,
}: {
  source: string;
  layoutKey?: string | undefined;
  compact?: boolean | undefined;
  readOnly?: boolean | undefined;
}) {
  // Follow the app's active color scheme so the diagram flips with the
  // ColorSchemeToggle. `useColorScheme` tracks the toggle (including its
  // "system" setting via `systemMode`); the static `palette.mode` is only a
  // fallback for hosts rendered outside a color-scheme-aware provider.
  const { mode, systemMode } = useColorScheme();
  const paletteMode = useTheme().palette.mode;
  const theme: DiagramTheme =
    (mode === "system" ? systemMode : mode) ?? (paletteMode === "dark" ? "dark" : "light");

  // Manually dragged positions round-trip through here — without holding the
  // emitted layout, a dropped node snaps straight back to the auto-layout.
  // The layout is a viewing aid, not saved diagram state: it persists per
  // `layoutKey` in localStorage but is keyed to a fingerprint of the DSL, so
  // any design.cell change (a streamed edit, a restructure) resets it.
  const [layout, setLayout] = useState<CustomLayout | null>(() => readStoredLayout(layoutKey));
  const activeLayout = layout && layout.sourceFingerprint === fingerprintSource(source) ? layout : null;

  useEffect(() => {
    if (layout && !activeLayout) {
      setLayout(null);
      writeStoredLayout(layoutKey, null);
    }
  }, [layout, activeLayout, layoutKey]);

  const handleLayoutChange = useCallback(
    (next: CustomLayout) => {
      setLayout(next);
      writeStoredLayout(layoutKey, next);
    },
    [layoutKey],
  );

  return (
    <CellDiagram
      source={source}
      tolerant
      theme={theme}
      customLayout={activeLayout}
      onCustomLayoutChange={handleLayoutChange}
      {...(compact === undefined ? {} : { compact })}
      {...(readOnly === undefined ? {} : { readOnly })}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
