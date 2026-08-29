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

import { Alert, Box, Skeleton, Typography } from "@wso2/oxygen-ui";
import { Activity } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import { SectionTitle } from "../../../components/SectionTitle";
import type { StatusTone } from "../../../components/StatusChip";
import { useSession } from "../../../auth/SessionContext";
import { useActivityFeed } from "../../activity/hooks/useActivityFeed";
import { activityLine } from "../../activity/lib/render";

// Maps an activity item's tone to the leading status dot's colour.
const DOT_COLOR: Record<StatusTone, string> = {
  error: "error.main",
  warning: "warning.main",
  info: "info.main",
  success: "success.main",
  primary: "primary.main",
  neutral: "text.disabled",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

// The overview shows only the newest few events — it's a glanceable summary,
// not the history; the feed itself keeps everything.
const OVERVIEW_EVENT_LIMIT = 6;

// The overview's "recent activity" feed: a status-dotted timeline (dots joined
// by a vertical rail) of what the platform's agents — and every collaborating
// user — have done on this project, sourced from the real activity feed
// (seeded read + SSE tail). The Builds page owns the detail.
export function RecentActivity({ projectName }: { projectName: string }) {
  const { user } = useSession();
  const { events, isPending, isError } = useActivityFeed(projectName);
  const items = events
    .slice(0, OVERVIEW_EVENT_LIMIT)
    .map((e) => activityLine(e, user.email));

  return (
    <div>
      <SectionTitle>Recent activity</SectionTitle>
      {isError ? (
        <Alert severity="error">Failed to load activity</Alert>
      ) : isPending ? (
        <Skeleton variant="rounded" height={72} aria-label="Loading activity" />
      ) : items.length === 0 ? (
        <EmptyState
          bordered
          icon={<Activity size={28} />}
          title="No activity yet"
          description="Agents report what they are doing here as they work."
        />
      ) : (
        <Box sx={{ mt: 1 }}>
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <Box key={item.id} sx={{ display: "flex", gap: 1.5 }}>
                {/* Rail: the dot, and a line filling the row height down to the
                    next dot (omitted on the last item). */}
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      bgcolor: DOT_COLOR[item.tone],
                      mt: "5px",
                    }}
                  />
                  {!last && (
                    <Box sx={{ flexGrow: 1, width: "2px", bgcolor: "divider", mt: 0.5 }} />
                  )}
                </Box>
                <Box sx={{ minWidth: 0, pb: last ? 0 : 2 }}>
                  <Typography variant="body2" sx={{ color: "text.primary" }}>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {item.actor}
                    </Box>{" "}
                    {item.text}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {relativeTime(item.occurredAt)}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </div>
  );
}
