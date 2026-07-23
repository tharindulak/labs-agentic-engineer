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

import type React from "react";
import { lazy, memo, Suspense } from "react";
import { Box, CircularProgress, Typography } from "@wso2/oxygen-ui";

// Lazy-loaded leaf keeps the renderer's heavy transitive deps (@xyflow, dagre)
// and its stylesheet out of the main bundle until the diagram is actually
// shown. The diagram is driven entirely by a cell DSL `source` string.
const CellDiagram = lazy(() => import("./CellDiagramInner.js"));

export interface CellDiagramViewProps {
  /**
   * Cell DSL source text. Rendered in tolerant mode so a still-growing
   * `design.cell` (streamed live) draws its partial diagram instead of an
   * error placeholder. Blank/undefined → the empty state.
   */
  source?: string | undefined;
  /** Optional override for the empty-state copy. */
  emptyState?: React.ReactNode;
  /**
   * Stable identity (e.g. a project name) under which manually dragged node
   * positions persist in localStorage. The stored layout is keyed to a
   * fingerprint of `source`, so any change to the DSL discards it — moving
   * components is a viewing aid, never saved diagram state. Omit to keep
   * dragged positions in memory only.
   */
  layoutKey?: string | undefined;
}

export const CellDiagramView = memo(function CellDiagramView({
  source,
  emptyState,
  layoutKey,
}: CellDiagramViewProps) {
  const hasSource = typeof source === "string" && source.trim().length > 0;
  if (!hasSource) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        {emptyState ?? (
          <Typography variant="body2">
            Generate a design to see the cell diagram.
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
      <Suspense
        fallback={
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        }
      >
        <CellDiagram source={source} layoutKey={layoutKey} />
      </Suspense>
    </Box>
  );
});
