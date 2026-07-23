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

import type { MouseEvent } from "react";
import { Chip, Tooltip } from "@wso2/oxygen-ui";
import { GitHub } from "@wso2/oxygen-ui-icons-react";

// The GitHub issue affordance for a task (task list row + task detail header):
// the octocat paired with the issue number (`⌾ #12`) so the link states which
// issue it opens instead of showing a bare, ambiguous icon.
export function GitHubIssueLink({
  issueNumber,
  issueUrl,
  onClick,
}: {
  issueNumber: number;
  issueUrl: string;
  /** Row usage stops propagation so the icon doesn't also open the task. */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Tooltip title="Open the GitHub issue">
      <Chip
        component="a"
        href={issueUrl}
        target="_blank"
        rel="noreferrer"
        clickable
        size="small"
        variant="outlined"
        icon={<GitHub size={14} />}
        label={`#${issueNumber}`}
        aria-label={`GitHub issue #${issueNumber}`}
        {...(onClick ? { onClick } : {})}
        sx={{
          fontVariantNumeric: "tabular-nums",
          // The lucide-style icon doesn't inherit the Chip's icon margins, so
          // it sits flush against the pill's left edge — space it explicitly.
          "& .MuiChip-icon": { ml: 0.75, mr: -0.25 },
        }}
      />
    </Tooltip>
  );
}
