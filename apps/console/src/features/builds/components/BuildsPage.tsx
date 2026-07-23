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

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  type TextFieldProps,
} from "@wso2/oxygen-ui";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "../../../components/PageHeader";
import { SectionTitle } from "../../../components/SectionTitle";
import { StatusChip, type StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { TasksList } from "../../tasks/components/TasksList";
import { UsageChip } from "../../usage/components/UsageChip";
import { useBuilds } from "../api/queries";

type BuildSummary = components["schemas"]["BuildSummary"];

// Read-only current-build view (#185): the selected build's summary + its
// tag-scoped task list, with an autocomplete over built tags for history.
// Builds are triggered from the Spec view — no actions here.
export function BuildsPage({
  projectName,
  tag,
  onTagChange,
}: {
  projectName: string;
  tag: string | undefined;
  onTagChange: (tag: string | undefined) => void;
}) {
  const builds = useBuilds(projectName);

  // The header is unconditional (it renders through every state below) so
  // the back link stays reachable even while builds are
  // loading or failed to load — matching the pattern every other adopted
  // page uses (render the header, then branch on the body).
  const header = (
    <PageHeader
      title="Builds"
      backTo={{
        link: <Link to="/projects/$projectName" params={{ projectName }} />,
        label: "Back to Overview",
      }}
    />
  );

  if (builds.isPending) {
    return (
      <>
        {header}
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading builds" />
        </Box>
      </>
    );
  }

  if (builds.isError) {
    return (
      <>
        {header}
        <Alert
          severity="error"
          action={<Button onClick={() => void builds.refetch()}>Retry</Button>}
        >
          Failed to load builds
          {builds.error instanceof Error && builds.error.message
            ? `: ${builds.error.message}`
            : ""}
        </Alert>
      </>
    );
  }

  // An unknown/absent ?tag falls back to the newest build (the list is
  // newest-first), so a stale shared link degrades to "latest" not a 404.
  const newest = builds.data[0];
  const selected = builds.data.find((b) => b.tag === tag) ?? newest;
  if (!newest || !selected) {
    return (
      <>
        {header}
        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
          No builds yet — publish your spec and click Build in the spec view to
          start the first one.
        </Typography>
      </>
    );
  }

  // The version picker lives up in the header row (same level as the title),
  // so it reads as a page-level control and the summary card can span full
  // width below it.
  const versionSelector = (
    <Autocomplete
      options={builds.data.map((b) => b.tag)}
      value={selected.tag}
      onChange={(_, value) =>
        // Selecting the newest build clears ?tag — the default view.
        onTagChange(value && value !== newest.tag ? value : undefined)
      }
      disableClearable
      size="small"
      sx={{ width: 180, flexShrink: 0 }}
      renderInput={(params) => (
        // MUI's render params don't declare `| undefined` on their
        // optional props, which exactOptionalPropertyTypes rejects — the
        // cast is the documented escape hatch for this spread.
        <TextField {...(params as TextFieldProps)} label="Version" />
      )}
    />
  );

  return (
    <>
      {/* No status chip in the header — the build's status lives on the
          summary card below (next to the version), so a header chip would just
          duplicate it. */}
      <PageHeader
        title="Builds"
        backTo={{
          link: <Link to="/projects/$projectName" params={{ projectName }} />,
          label: "Back to Overview",
        }}
        actions={versionSelector}
      />
      <Box sx={{ mb: 4 }}>
        <BuildSummaryCard build={selected} />
      </Box>
      <SectionTitle>Tasks</SectionTitle>
      <TasksList projectName={projectName} tag={selected.tag} />
    </>
  );
}

// Segmented progress: done (success) then failed (error) fill from the left
// over a neutral track — a glanceable read of how far the build has gotten.
function BuildProgressBar({
  done,
  failed,
  total,
}: {
  done: number;
  failed: number;
  total: number;
}) {
  if (total <= 0) return null;
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  return (
    <Box
      sx={{
        display: "flex",
        width: 200,
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "action.hover",
      }}
    >
      <Box sx={{ width: pct(done), bgcolor: "success.main" }} />
      <Box sx={{ width: pct(failed), bgcolor: "error.main" }} />
    </Box>
  );
}

// Status chip vocabulary mirrors the overview's build stage (#183); a list
// read has no live query, so "started" barely occurs (treated as running).
function buildStatusChip(status: BuildSummary["status"]): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case "completed":
      return { label: "Succeeded", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "error" };
    default: // started / in_progress
      return { label: "Running", tone: "info" };
  }
}

function BuildSummaryCard({ build }: { build: BuildSummary }) {
  const chip = buildStatusChip(build.status);
  const { total, done, failed } = build.tasks;
  // total is written once the plan step finishes, so a running build with no
  // tasks is still planning — say so instead of "0/0 tasks done".
  const planning = chip.label === "Running" && total === 0;
  const started = new Date(build.startedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    // Subtle filled background sets the run summary apart from the white,
    // outlined task cards below so it reads as the build's header, not a row.
    <Card variant="outlined" sx={{ bgcolor: "action.hover" }}>
      <CardContent sx={{ "&:last-child": { pb: 2.5 } }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h6">{build.tag}</Typography>
          <StatusChip label={chip.label} tone={chip.tone} appearance="soft" dot />
          <Typography variant="body2" color="text.secondary">
            Started {started}
          </Typography>
          {/* Actual build cost (#245): the run's aggregate coding-execution
              usage — accrues on the existing poll while the build runs.
              Absent for runs that predate usage capture. */}
          {build.usage && (
            <UsageChip
              usage={build.usage}
              context={`Agent spend — build ${build.tag}`}
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          {planning ? (
            // Subtle "planning" signal for the selected tag: the run has started
            // but hasn't emitted its task plan yet (total === 0 while Running).
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "center" }}
            >
              <CircularProgress
                size={12}
                thickness={5}
                aria-label="Generating tasks"
              />
              <Typography variant="body2" color="text.secondary">
                Generating tasks…
              </Typography>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <BuildProgressBar done={done} failed={failed} total={total} />
              <Typography variant="body2" color="text.secondary">
                <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
                  {done}/{total} done
                </Box>
                {failed > 0 && (
                  <>
                    {" · "}
                    <Box component="span" sx={{ color: "error.main", fontWeight: 600 }}>
                      {failed} failed
                    </Box>
                  </>
                )}
              </Typography>
            </Stack>
          )}
        </Stack>
        {build.status === "failed" && build.reason && (
          // Surface WHY a build failed (the devflow's recorded error) instead of
          // a bare "Failed" badge — otherwise the reason is buried in Temporal.
          <Typography
            variant="caption"
            color="error.main"
            sx={{ display: "block", mt: 1, whiteSpace: "pre-wrap" }}
          >
            {build.reason}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
