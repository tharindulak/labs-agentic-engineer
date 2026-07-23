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

import { Box, Chip, Divider, IconButton, Stack, TextField, Typography } from "@wso2/oxygen-ui";
import { FolderOpen, Send } from "@wso2/oxygen-ui-icons-react";

// The composer (task 3): context chip, textarea, send. Disabled while a turn
// runs; when the running turn is a TEAMMATE's, `hint` explains why so the
// input reads as intentionally locked, not broken.
export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  contextLabel,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  contextLabel: string;
  /** Why the input is locked (teammate turn), or null when free. */
  hint?: string | null;
}) {
  return (
    <Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<FolderOpen size={14} />}
            label={contextLabel}
            sx={{
              maxWidth: "100%",
              // The lucide-style icon doesn't inherit the Chip's icon margins,
              // so it sits flush against the border — space it explicitly and
              // align it with the label.
              "& .MuiChip-icon": { ml: 0.75, mr: -0.25, flexShrink: 0 },
              "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
            }}
          />
        </Stack>
        {hint && (
          <Typography
            data-testid="input-hint"
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            {hint}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
          <TextField
            fullWidth
            multiline
            maxRows={5}
            size="small"
            placeholder={hint ? "Waiting for the current turn…" : "Ask the agent to edit the spec…"}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <IconButton
            color="primary"
            aria-label="Send message"
            disabled={disabled || !value.trim()}
            onClick={onSubmit}
          >
            <Send size={18} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}
