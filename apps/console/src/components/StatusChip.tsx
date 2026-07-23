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

import { Box, Chip, alpha } from "@wso2/oxygen-ui";

// Console-wide status/kind chip (Task 4): every domain (task status, alert
// classification, skill origin, project phase, ...) maps its own vocabulary
// to one of these tones in a single place — see each feature's own
// `*chip`/`*Tone` mapping function — so every pill in the app shares one
// size, shape, and palette instead of three divergent chip components.
// `primary` covers a "brand" kind (the org skill origin) that isn't a state
// but still needs to stand out from the neutral default.
export type StatusTone =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "neutral"
  | "primary";

const TONE_COLOR: Record<
  StatusTone,
  "default" | "primary" | "success" | "info" | "warning" | "error"
> = {
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
  neutral: "default",
  primary: "primary",
};

// The palette family each tone reads its soft tint from. `neutral` has no
// palette family, so its soft look is derived from text/action tokens below.
const TONE_PALETTE: Record<
  Exclude<StatusTone, "neutral">,
  "primary" | "success" | "info" | "warning" | "error"
> = {
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
  primary: "primary",
};

// `soft`: a low-emphasis status pill — a faint tinted background with the
// tone's own text colour and no border — for spots where a solid filled chip
// reads as a button (a status beside a page title, a build's live state).
// `dot` prefixes a small tone-coloured dot so the pill reads as a live status
// indicator ("● Running"). Solid stays the default so dense rows are
// unaffected.
export function StatusChip({
  label,
  tone,
  variant,
  appearance = "solid",
  dot = false,
}: {
  label: string;
  tone: StatusTone;
  variant?: "filled" | "outlined";
  appearance?: "solid" | "soft";
  dot?: boolean;
}) {
  if (appearance === "soft") {
    const isNeutral = tone === "neutral";
    const labelNode = dot ? (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
        <Box
          sx={(theme) => ({
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: isNeutral
              ? theme.palette.text.secondary
              : theme.palette[TONE_PALETTE[tone]].main,
          })}
        />
        <span>{label}</span>
      </Box>
    ) : (
      label
    );
    return (
      <Chip
        size="small"
        label={labelNode}
        sx={(theme) =>
          isNeutral
            ? {
                bgcolor: theme.palette.action.hover,
                color: "text.secondary",
                fontWeight: 500,
              }
            : {
                bgcolor: alpha(theme.palette[TONE_PALETTE[tone]].main, 0.14),
                color: theme.palette[TONE_PALETTE[tone]].main,
                fontWeight: 500,
              }
        }
      />
    );
  }

  return (
    <Chip
      size="small"
      label={label}
      color={TONE_COLOR[tone]}
      {...(variant ? { variant } : {})}
    />
  );
}
