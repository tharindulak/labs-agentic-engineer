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
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ArrowLeft,
  GitHub,
  GitPullRequest,
} from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import { useTask } from "../api/queries";
import { useTaskLog } from "../hooks/useTaskLog";
import { TaskLogView } from "./TaskLogView";
import { StatusChip } from "../../../components/StatusChip";
import { taskChip } from "../api/status";
import { EXEC_ACTIVE, useSecondsSince } from "./TaskPage";

const LinkIconButton = createLink(IconButton);

// The validation console: the deployments board's validation chip lands here.
// Same anatomy as TaskPage (get-task seeds the header, the SSE stream owns
// everything after — the validation task IS a task to those endpoints), but
// framed as the run's validation phase: back goes to the deployments board,
// and the header jumps to the validation issue and, once opened, its PR.
export function ValidationPage({
  projectName,
  issueNumber,
}: {
  projectName: string;
  issueNumber: number;
}) {
  const detail = useTask(projectName, issueNumber);
  const log = useTaskLog(projectName, issueNumber);
  // An attempt is still queued/running — used to reassure during long, silent
  // stretches (a Playwright runner cold start pulls a hefty browser image).
  const anyRunning = log.executions.some((e) => EXEC_ACTIVE.has(e.status));
  // Restart the idle clock on every new line and on (re)connect; only tick
  // while something is actually being waited on. Called before the early
  // returns below so the hook order stays stable (rules of hooks).
  const idleSeconds = useSecondsSince(
    `${log.phase}:${log.lines.length}`,
    log.phase !== "ended" && (log.lines.length === 0 || anyRunning),
  );

  if (detail.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading validation" />
      </Box>
    );
  }

  if (detail.isError) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
      >
        Failed to load the validation task
        {detail.error instanceof Error && detail.error.message
          ? `: ${detail.error.message}`
          : ""}
      </Alert>
    );
  }

  // The stream's view of the task is fresher than the initial fetch — the PR
  // button appears live once the validation PR opens.
  const derivedStatus =
    log.settledStatus ?? log.task?.derivedStatus ?? detail.data.derivedStatus;
  const title = log.task?.title ?? detail.data.title;
  const issueUrl = log.task?.issueUrl ?? detail.data.issueUrl;
  const prUrl = log.task?.prUrl ?? detail.data.prUrl;

  let tail: string | undefined;
  if (log.phase === "reconnecting") {
    tail = "· connection lost — reconnecting…";
  } else if (log.phase === "connecting") {
    tail = "· attaching to the validation log…";
  } else if (log.phase === "ended") {
    tail = `· validation settled — ${derivedStatus}`;
  } else if (log.lines.length === 0) {
    // Live, no timeline yet: the validation attempt is being prepared
    // (dispatch / scheduling) before the runner's first line lands.
    tail =
      `· preparing the validation agent…${idleSeconds >= 20 ? " (a cold start can take up to a minute)" : ""}` +
      ` · ${idleSeconds}s`;
  } else if (anyRunning && idleSeconds >= 5) {
    // Timeline has content but nothing new for a bit and an attempt is live —
    // reassure rather than leave the last line looking stuck.
    tail = `· still working… · ${idleSeconds}s since last update`;
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // Fill the remaining page height so the log gets a real scroll area.
        minHeight: 480,
        height: "calc(100vh - 320px)",
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", mb: 2 }}
      >
        <Tooltip title="Back to deployments">
          <LinkIconButton
            to="/projects/$projectName/deployments"
            params={{ projectName }}
            aria-label="Back to deployments"
          >
            <ArrowLeft size={18} />
          </LinkIconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          #{issueNumber}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, minWidth: 0 }}>
          {title}
        </Typography>
        <StatusChip
          label={taskChip(derivedStatus).label}
          tone={taskChip(derivedStatus).tone}
          appearance="soft"
        />
        <Box sx={{ flexGrow: 1 }} />
        {prUrl && (
          <Tooltip title="Open the validation PR">
            <IconButton
              component="a"
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Validation pull request"
            >
              <GitPullRequest size={18} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Open the validation issue">
          <IconButton
            component="a"
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`GitHub issue #${issueNumber}`}
          >
            <GitHub size={18} />
          </IconButton>
        </Tooltip>
      </Stack>
      <TaskLogView lines={log.lines} {...(tail ? { tail } : {})} />
    </Box>
  );
}
