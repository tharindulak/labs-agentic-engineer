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

import type { ReactNode } from "react";
import { Box, Typography } from "@wso2/oxygen-ui";

// Console-wide empty-state primitive (Task 4): icon + title + description +
// an optional caller-built action, matching the Projects "No projects yet"
// look (the canonical style). `icon`/`title` are optional and `compact`
// tightens the padding for the handful of inline placeholders (a
// deployments board column, a page with no components yet) that only need
// a themed sentence, not the full icon+title moment. `bordered` frames it in
// a subtle dashed box for inline section placeholders (the overview's Agent
// Activity / Components columns) that need to hold their space without a
// solid card.
export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
  bordered?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  bordered = false,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        textAlign: "center",
        py: compact ? 3 : 8,
        px: 2,
        ...(bordered && {
          border: 1,
          borderStyle: "dashed",
          borderColor: "divider",
          borderRadius: 2,
        }),
      }}
    >
      {icon && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            opacity: 0.3,
            mb: 2,
          }}
        >
          {icon}
        </Box>
      )}
      {title && (
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
      )}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 480, mx: "auto", mb: action ? 2 : 0 }}
      >
        {description}
      </Typography>
      {action}
    </Box>
  );
}
