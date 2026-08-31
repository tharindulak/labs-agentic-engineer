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

import { Alert, Box, Button, Card, CircularProgress, Skeleton } from "@wso2/oxygen-ui";
import { ArrowUpRight } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import { CellDiagramView } from "@aep/ui-cell-diagram-view";
import { EmptyState } from "../../../components/EmptyState";
import { SectionTitle } from "../../../components/SectionTitle";
import { DESIGN_CELL_PATH } from "../../spec/api/designTree";
import { useSpecFiles, useSpecFileContent } from "../../spec/api/queries";

// MUI's polymorphic `component={Link}` does not typecheck against the router's
// typed `to`/`params`; createLink is the console's established adapter.
const OpenInSpec = createLink(Button);

/**
 * The renderer's pan/zoom/drag and its own control bar belong to the workspace,
 * not to a summary panel.
 *
 * This hides the CHROME only — a zoom control and a "click a component" hint
 * left on screen doing nothing is worse than either extreme. Read-only is NOT
 * `pointer-events: none`, which is what this used to rely on: React Flow's own
 * stylesheet sets `pointer-events: all` on `.react-flow__node`, so the nodes
 * re-enabled themselves and stayed draggable, and pointer events never governed
 * the keyboard at all — all eleven nodes sat in the tab order with
 * `tabindex="0"`. The renderer's own `readOnly` does that job; see
 * `CellDiagramView`.
 */
const READ_ONLY_SX = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  "& .zoom-controls, & .canvas-notification": { display: "none" },
} as const;

/**
 * A preview, sized as one — and sized against a hard floor.
 *
 * Height was chased upward first (360, then 520) on the theory that enough of
 * it would make the graph readable in place. It does not: the renderer fits the
 * WHOLE cell into whatever box it gets, externals and gateways included, so a
 * real project lands near a quarter scale however tall the box is. Legibility
 * here was never a height problem, which is what makes this a preview with a
 * link rather than a diagram you read.
 *
 * It is a MINIMUM, not a fixed height: the panel stretches to whatever the
 * index column beside it comes to, so the two columns end level instead of
 * leaving a band of empty page under the shorter one. More height is free here
 * — the graph simply fits itself into a bigger box.
 *
 * Going the other way has a real limit. `DiagramCanvas` sets `minZoom={0.25}`,
 * and `fitView` clamps to it — so below the height a graph needs AT 25% the
 * diagram stops shrinking and starts being cropped. The demo cell measures
 * 1080 units tall and therefore needs ~310px; this leaves a little over that.
 * A substantially larger project will crop at the bottom, and "Open in spec" is
 * the way to see it whole.
 */
const DIAGRAM_MIN_HEIGHT = 340;

/**
 * The project's shape, on the page that answers "what is this".
 *
 * Same renderer as the spec workspace's Architecture tab, same source file, and
 * deliberately the same `layoutKey` — a layout you arrange in one place is the
 * layout you see in the other. What it does NOT share is the collab room: the
 * spec panel subscribes to the live doc so a design turn draws as it streams,
 * which on a summary page would be a diagram rewriting itself while you read
 * the rest of the page. Here it is a one-shot committed read (ADR-0008: derive
 * in the browser from the authored source, render read-only, commit nothing).
 */
export function OverviewArchitecture({ projectName }: { projectName: string }) {
  const files = useSpecFiles(projectName);
  // A sha of "" means the metadata row exists but the blob does not — not
  // something to fetch.
  const cell =
    files.data?.find((f) => f.path === DESIGN_CELL_PATH && f.sha !== "") ?? null;
  const content = useSpecFileContent(projectName, cell);

  const drawn = cell !== null && !files.isError && !content.isError;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* The way out lives in the section header, not wrapped around the
          diagram: a link around the whole panel would nest the renderer's own
          controls inside a button, and it measured as a container that never
          fitted its graph. Only a drawn diagram gets the link — an empty state
          already says what to do. */}
      <SectionTitle
        {...(drawn && {
          trailing: (
            // A growing flex box, not `ml: auto` on the link: Stack's own
            // `& > :not(style) ~ :not(style)` margin rule out-specifies a
            // single sx class, so an auto margin here silently stays at the
            // gap width. Filling the row and right-aligning inside it does
            // not fight the cascade.
            <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
              <OpenInSpec
                to="/projects/$projectName/spec"
                params={{ projectName }}
                // Land on the Architecture view, not the spec workspace's
                // default file. The link is offered BECAUSE a diagram is drawn
                // here; dropping the reader on the PRD makes them find it
                // again in the rail.
                search={{ view: "architecture" as const }}
                size="small"
                endIcon={<ArrowUpRight size={14} />}
                // Kept inside the heading's own line box. A default small
                // Button is 9px taller than an h6, which pushed this whole
                // column down and left its card sitting below the one beside
                // it.
                sx={{ minHeight: 0, py: 0, lineHeight: 1.6 }}
              >
                Open in spec
              </OpenInSpec>
            </Box>
          ),
        })}
      >
        Architecture
      </SectionTitle>
      <Card
        variant="outlined"
        sx={{ flex: 1, minHeight: DIAGRAM_MIN_HEIGHT, display: "flex" }}
      >
        <Box sx={drawn ? READ_ONLY_SX : { flex: 1, minWidth: 0, display: "flex" }}>
          <Body
            filesPending={files.isPending}
            filesError={files.isError}
            hasCell={cell !== null}
            contentPending={content.isPending}
            contentError={content.isError}
            source={content.data?.content}
            projectName={projectName}
          />
        </Box>
      </Card>
    </Box>
  );
}

function Body({
  filesPending,
  filesError,
  hasCell,
  contentPending,
  contentError,
  source,
  projectName,
}: {
  filesPending: boolean;
  filesError: boolean;
  hasCell: boolean;
  contentPending: boolean;
  contentError: boolean;
  source: string | undefined;
  projectName: string;
}) {
  if (filesPending) {
    return <Skeleton variant="rectangular" width="100%" height="100%" />;
  }
  // The diagram is a read of the design, not the design itself: a failed read
  // degrades to a sentence rather than taking the overview down with it.
  if (filesError) {
    return (
      <Centered>
        <Alert severity="error" sx={{ m: 2 }}>
          Failed to load the architecture.
        </Alert>
      </Centered>
    );
  }
  // No design.cell means no design turn has run yet — the normal state of a
  // project whose spec is still being written, so it says what the diagram is
  // FOR rather than what is missing from the repository.
  if (!hasCell) {
    return (
      <Centered>
        <EmptyState
          compact
          title="No architecture yet"
          description="Once the agent designs your app, this shows its components and how they connect."
        />
      </Centered>
    );
  }
  if (contentPending) {
    return (
      <Centered>
        <CircularProgress aria-label="Loading the architecture diagram" />
      </Centered>
    );
  }
  if (contentError) {
    return (
      <Centered>
        <Alert severity="error" sx={{ m: 2 }}>
          Failed to load the architecture.
        </Alert>
      </Centered>
    );
  }
  return (
    <CellDiagramView
      source={source ?? undefined}
      // Shared with the spec workspace's Architecture tab on purpose.
      layoutKey={projectName}
      // The renderer reserves 112px top and bottom for floating chrome this
      // panel hides — 224px of a 340px card, so two thirds of the box went to
      // room for controls that are not on screen. `compact` fits the graph to
      // the box instead.
      compact
      // Not a thing you can grab, and not a thing you can tab into.
      readOnly
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </Box>
  );
}
