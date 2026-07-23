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
import { useSpecFileContent } from "../api/queries";
import { DESIGN_CELL_PATH } from "../api/designTree";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useYTextString } from "../collab/useYTextString";

export function CellDiagramPanel({
  projectName,
  files,
  collab,
}: {
  projectName: string;
  files: SpecFileEntry[];
  collab: CollabSpec;
}) {
  // design.cell IS the architecture: the diagram always renders the file
  // itself, never a projection of the design.json bundle. Connected, the
  // collab doc supplies it live (committed content is seeded into the room;
  // an agent editFile lands in place, a restructure's removeFile + addFile
  // re-streams line by line). Solo/offline, the committed git blob is
  // fetched over REST instead.
  const liveSource = useYTextString(collab.getFileText(DESIGN_CELL_PATH));
  const committed =
    files.find((f) => f.path === DESIGN_CELL_PATH && f.sha !== "") ?? null;
  const restFallback = liveSource === null ? committed : null;
  const rest = useSpecFileContent(projectName, restFallback);
  const source =
    liveSource ?? (restFallback ? (rest.data?.content ?? null) : null);
  // An agent peer in the room means a design turn is running; badge the pane
  // and show a "waiting" cell rather than the generic "generate a design"
  // empty state. The badge MUST key on the peer, not the live text: the doc
  // is re-seeded from git on every workspace load, so text alone would keep
  // "Designing…" up long after the turn ended (#239).
  const agentBusy = collab.peers.some((p) => p.kind === "agent");

  if (restFallback && rest.isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading architecture diagram" />
      </Box>
    );
  }
  if (restFallback && rest.isError) {
    return <Alert severity="error">Failed to load the architecture diagram source.</Alert>;
  }

  // The diagram fills the pane. While a turn is running, a thin toolbar row
  // carries the "Designing…" badge; otherwise the diagram takes the whole
  // pane. Both view components have a `flex: 1, minHeight: 0` root, so the
  // flex column lets them fill the space without re-introducing the sizing
  // bug they were written to avoid.
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {agentBusy && Boolean(source?.trim()) && (
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
        source={source ?? undefined}
        layoutKey={projectName}
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
