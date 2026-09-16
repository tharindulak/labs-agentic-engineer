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
  Badge,
  Box,
  IconButton,
  NotificationPanel,
  Tooltip,
  Typography,
  useAppShell,
} from "@wso2/oxygen-ui";
import { Bell } from "@wso2/oxygen-ui-icons-react";
import { useAttentionIssues } from "../features/issues/api/queries";
import { useAttentionUnread } from "../features/issues/hooks/useAttentionUnread";
import { attentionReasonLabel } from "../features/issues/attention";

// Top-nav notification bell (#154, repointed): global, read-only,
// client-tracked unread state — but now fed by issue-lifecycle attention
// events (unverified fix, no-change verdict, escalated recurrence) instead
// of every RCA report. The Alerts bell's original job — surfacing every
// report — stays on the dedicated Alerts left-nav page, unchanged; this
// bell now answers a narrower question: does anything need a human to look
// at it right now.
export function NotificationButton() {
  const { actions } = useAppShell();
  const { items } = useAttentionIssues();
  const { unreadCount, markAllSeen } = useAttentionUnread(items);

  return (
    <Tooltip title="Notifications">
      <IconButton
        onClick={() => {
          actions.toggleNotificationPanel();
          markAllSeen();
        }}
        size="small"
        sx={{ color: "text.secondary" }}
        aria-label="Notifications"
      >
        <Badge badgeContent={unreadCount} color="error" max={99} invisible={unreadCount === 0}>
          <Bell size={20} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}

// Panel body — no per-item read state (the badge clears as a whole on open,
// per #154's decision), so this only needs the attention-issue list itself.
// Issues have no console-side detail page (see the design doc's non-goals),
// so each item opens straight to the issue's GitHub URL.
export function AlertsNotificationPanel() {
  const { state, actions } = useAppShell();
  const { isPending, items, failedCount } = useAttentionIssues();

  const openIssue = (url: string) => {
    actions.toggleNotificationPanel();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <NotificationPanel open={state.notificationPanelOpen} onClose={actions.toggleNotificationPanel}>
      <NotificationPanel.Header>
        <NotificationPanel.HeaderIcon>
          <Bell size={20} />
        </NotificationPanel.HeaderIcon>
        <NotificationPanel.HeaderTitle>Notifications</NotificationPanel.HeaderTitle>
        <NotificationPanel.HeaderClose />
      </NotificationPanel.Header>
      {isPending ? (
        <NotificationPanel.EmptyState />
      ) : items.length === 0 ? (
        <NotificationPanel.EmptyState />
      ) : (
        <NotificationPanel.List>
          {failedCount > 0 && (
            <Box sx={{ px: 3, py: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Some projects could not be checked — showing what loaded.
              </Typography>
            </Box>
          )}
          {items.map((item) => (
            <NotificationPanel.Item
              key={`${item.project}-${item.number}`}
              id={`${item.project}-${item.number}`}
              type="info"
              read
            >
              <NotificationPanel.ItemTitle>{item.title}</NotificationPanel.ItemTitle>
              <NotificationPanel.ItemMessage>
                {item.project} · {attentionReasonLabel(item.reason)}
              </NotificationPanel.ItemMessage>
              <NotificationPanel.ItemAction onClick={() => openIssue(item.url)}>
                View
              </NotificationPanel.ItemAction>
            </NotificationPanel.Item>
          ))}
        </NotificationPanel.List>
      )}
    </NotificationPanel>
  );
}
