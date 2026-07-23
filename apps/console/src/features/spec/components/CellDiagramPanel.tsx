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

import { Alert, Box, Chip, CircularProgress, Typography } from "@wso2/oxygen-ui";
import { CellDiagramView } from "@aep/ui-cell-diagram-view";
import { useDerivedCellDiagram } from "../api/useDerivedDesign";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useYTextString } from "../collab/useYTextString";

/** Project-level cell-diagram DSL the agent streams first, ahead of design.json. */
const DESIGN_CELL_PATH = "specs/design/design.cell";

export function CellDiagramPanel({
  projectName,
  files,
  collab,
}: {
  projectName: string;
  files: SpecFileEntry[];
  collab: CollabSpec;
}) {
  const { dsl, isPending, isError } = useDerivedCellDiagram(projectName, files);

  // The committed design.json bundle is authoritative — `dsl` is derived from
  // it (design.json → cell DSL, same boundary rules as design.cell). While it
  // is not yet resolved (no committed design.json, or its fetches still
  // pending/failing mid-turn), fall back to the live `design.cell` DSL
  // streaming into the collab doc so the diagram renders piece-by-piece as the
  // agent writes it. Both paths feed the SAME renderer via a DSL string, so the
  // streamed and reloaded diagrams match.
  const liveSource = useYTextString(collab.getFileText(DESIGN_CELL_PATH));
  const derivedReady = !isPending && !isError && dsl != null;
  const streaming =
    !derivedReady && typeof liveSource === "string" && liveSource.trim().length > 0;
  // An agent peer in the room means a design is actively being generated; show a
  // "waiting" cell rather than the generic "generate a design" empty state.
  const agentBusy = collab.peers.some((p) => p.kind === "agent");
  // "Designing…" is true only while that agent is actually in the room. The
  // live design.cell text alone can't carry it: it is re-seeded from git on
  // every workspace load and the committed design.json can trail the session
  // by the collab flush debounce, so `streaming` stays true long after the
  // agent finished.
  const designing = streaming && agentBusy;

  if (!streaming && isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading architecture diagram" />
      </Box>
    );
  }
  if (!streaming && isError) {
    return <Alert severity="error">Failed to load the design sources for the diagram.</Alert>;
  }

  // The diagram fills the pane. While streaming, a thin toolbar row carries the
  // "Designing…" badge; otherwise the diagram takes the whole pane. Both view
  // components have a `flex: 1, minHeight: 0` root, so the flex column lets them
  // fill the space without re-introducing the sizing bug they were written to
  // avoid.
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {designing && (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Chip size="small" color="primary" variant="outlined" label="Designing…" />
        </Box>
      )}
      <CellDiagramView
        source={(streaming ? liveSource : dsl) ?? undefined}
        emptyState={
          agentBusy ? (
            <Typography variant="body2">
              Waiting for the agent to lay out the architecture…
            </Typography>
          ) : undefined
        }
      />
    </Box>
  );
}
