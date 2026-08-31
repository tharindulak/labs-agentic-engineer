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

import { useMemo } from "react";
import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
  alpha,
} from "@wso2/oxygen-ui";
import {
  ArrowUpRight,
  Box as BoxIcon,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  GitHub,
  GitPullRequest,
  LoaderCircle,
  Plug,
} from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";
import { runStamp } from "../lib/format";
import { buildDuration } from "../lib/ledger";
import {
  taskElapsedFrom,
  taskRowChip,
  taskRowNote,
  taskRowState,
  taskSettledAt,
  type RunClaims,
  type TaskRowState,
} from "../lib/taskRow";

type TaskView = components["schemas"]["TaskView"];

// MUI polymorphism does not carry the router's typed `to`/`params`;
// createLink is the console's established adapter.
const LinkButton = createLink(Button);

/**
 * The build page's task list — the design's arrangement 2b (ADR-0021 §3).
 *
 * One row per task, gates included: a connection to configure and a feature to
 * write are peers here, each with its own way out (§4). That is what replaced
 * the stage rail's separate provisioning section.
 */

const STATE_ICON: Record<
  TaskRowState,
  { Icon: typeof CircleCheck; palette: "success" | "info" | "warning" | "grey" }
> = {
  merged: { Icon: CircleCheck, palette: "success" },
  in_progress: { Icon: LoaderCircle, palette: "info" },
  blocked: { Icon: CircleAlert, palette: "warning" },
  // A pull request that is sent and not merged is waiting on a human, which is
  // the same call to action a hold makes — hence the same tone.
  pr_sent: { Icon: GitPullRequest, palette: "warning" },
  pending: { Icon: CircleDashed, palette: "grey" },
};

function StateTile({ state }: { state: TaskRowState }) {
  const { Icon, palette } = STATE_ICON[state];
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: 1.25,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: (t) =>
          palette === "grey"
            ? t.palette.action.hover
            : alpha(t.palette[palette].main, 0.12),
        color: palette === "grey" ? "text.disabled" : `${palette}.main`,
        // The spinner is the one thing on a row that may move: it is the
        // difference between "the agent is on this" and "this is just open".
        ...(state === "in_progress" && {
          "@keyframes taskSpin": { to: { transform: "rotate(360deg)" } },
          "& svg": { animation: "taskSpin 1s linear infinite" },
          // Same guard the rest of the console's motion carries. The icon is
          // a state tile first and an animation second, so holding it still
          // costs the reader nothing.
          "@media (prefers-reduced-motion: reduce)": {
            "& svg": { animation: "none" },
          },
        }),
      }}
    >
      <Icon size={18} aria-hidden />
    </Box>
  );
}

/** The component (or dependency) a task belongs to. */
function ComponentChip({ task }: { task: TaskView }) {
  if (!task.component) return null;
  const isGate = task.executorClass === "provision";
  const Icon = isGate ? Plug : BoxIcon;
  return (
    <Chip
      size="small"
      icon={<Icon size={12} />}
      label={task.component}
      sx={{ height: 22, flexShrink: 0, fontSize: "0.75rem" }}
    />
  );
}

export function BuildTaskRow({
  task,
  claims,
}: {
  task: TaskView;
  /** What the RUN says about this version's work — the only source of agent
   *  progress, since `TaskView.executions` is empty for agent work. */
  claims?: RunClaims | undefined;
}) {
  const state = taskRowState(task, claims);
  const chip = taskRowChip(state);
  const note = taskRowNote(task);
  const elapsedFrom = taskElapsedFrom(task, claims);
  const settledAt = taskSettledAt(task);

  const tint =
    state === "in_progress"
      ? "info"
      : state === "blocked" || state === "pr_sent"
        ? "warning"
        : null;

  return (
    <Box
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
        ...(tint && {
          bgcolor: (t) => alpha(t.palette[tint].main, 0.05),
        }),
      }}
    >
      <Stack
        direction="row"
        spacing={1.75}
        sx={{ alignItems: "flex-start", px: 2.25, py: 1.875 }}
      >
        <StateTile state={state} />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
            {/* Plain text, NOT a link. The title used to open the per-task
                detail page, which this surface no longer sends anyone to: the
                row already carries what that page led with — state, the agent's
                latest note, elapsed time — and the issue itself is one chip
                away. A link to a view nobody uses is a dead end that looks
                like a destination. */}
            <Typography
              component="span"
              sx={{
                fontSize: "0.90625rem",
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={task.title}
            >
              {task.title}
            </Typography>
            {/* Straight to GitHub, deliberately NOT to the task page: ADR-0013
                §5's one surviving idea is that an issue chip means the issue. */}
            <Chip
              size="small"
              component="a"
              href={task.issueUrl}
              target="_blank"
              rel="noreferrer"
              clickable
              icon={<GitHub size={13} />}
              label={`#${task.issueNumber}`}
              sx={{
                height: 22,
                flexShrink: 0,
                fontFamily: "monospace",
                fontSize: "0.75rem",
              }}
            />
          </Stack>

          <Stack
            direction="row"
            spacing={1.125}
            sx={{ alignItems: "center", mt: 0.875, minWidth: 0 }}
          >
            <ComponentChip task={task} />
            {note && (
              <Typography
                variant="caption"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  lineHeight: 1.55,
                  color:
                    state === "in_progress"
                      ? "info.main"
                      : state === "blocked" || state === "pr_sent"
                        ? "warning.main"
                        : "text.secondary",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {note}
              </Typography>
            )}
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexShrink: 0, pt: 0.625 }}
        >
          {state === "blocked" ? (
            // The way out, on the row that needs it (ADR-0021 §4).
            <LinkButton
              to="/resources"
              size="small"
              variant="outlined"
              endIcon={<ArrowUpRight size={13} />}
              sx={{ borderRadius: 999, height: 28 }}
            >
              Configure in Resources
            </LinkButton>
          ) : elapsedFrom ? (
            <Typography
              variant="caption"
              color="info.main"
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {buildDuration(elapsedFrom)}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {settledAt ? runStamp(settledAt) : chip.label}
            </Typography>
          )}
          {/* No chevron: it promised the whole ROW navigates, and only the
              title does. An affordance that does nothing is worse than none —
              the title is the link, and it looks like one. */}
        </Stack>
      </Stack>

      {/* No progress bar. It was indeterminate — the platform reports no
          percentage for a task — so it animated without ever measuring
          anything. The spinner on the row's status tile already says the agent
          is on this one. */}
    </Box>
  );
}

export function BuildTaskList({
  tasks,
  claims,
}: {
  tasks: TaskView[];
  claims?: RunClaims | undefined;
}) {
  // ASCENDING by issue number — the order the milestone was planned in, which
  // for a task list is its reading order: the gates the platform files first
  // come first, and the work that depends on them follows. `list-tasks` makes
  // no ordering promise, so GitHub's newest-first default showed through and
  // the list read backwards. Copied, never sorted in place: this same array is
  // what the counts and the header pulse are derived from.
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => a.issueNumber - b.issueNumber),
    [tasks],
  );

  return (
    <Box>
      {ordered.map((task) => (
        <BuildTaskRow
          key={task.issueNumber}
          task={task}
          {...(claims ? { claims } : {})}
        />
      ))}
    </Box>
  );
}
