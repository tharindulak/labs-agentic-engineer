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

import { Stack, Typography } from "@wso2/oxygen-ui";

/**
 * "agent working" — the design's own pulse line, from the handoff.
 *
 * A traced ECG rather than a dot: a dot that merely blinks says "something is
 * live", which every status chip in the app already says. The trace reads as
 * WORK being done, which is the one thing this indicator is for.
 *
 * `stroke="currentColor"` deliberately — the handoff hardcodes `#0097A7`, and
 * `design-system.md` forbids hex literals. The colour comes from the parent's
 * `info.main`, so it holds in both themes.
 *
 * The trace is a CSS animation rather than the handoff's SMIL `<animate>`, so
 * it can be switched off under `prefers-reduced-motion` the way every other
 * moving thing in the console is (StageRow, RunGlanceStrip). SMIL does not
 * answer to that query at all — it would have run regardless of the setting.
 * Reduced motion drops the dash pattern entirely, which draws the complete
 * line: the indicator still reads as a pulse trace, it just holds still.
 *
 * A PLAIN `<svg>`, not a `Box component="svg"`: MUI's system consumes `width`
 * and `height` as style props, so on a Box they never reach the element as SVG
 * attributes and the trace rendered at 81x27 instead of the design's 42x14.
 */
export function AgentPulse({ label = "agent working" }: { label?: string }) {
  return (
    <Stack
      direction="row"
      spacing={0.875}
      // flexShrink 0 + nowrap: in a crowded header row the label otherwise
      // wraps onto two lines and squeezes the trace against it.
      sx={{
        alignItems: "center",
        color: "info.main",
        flexShrink: 0,
        "@keyframes agentPulseTrace": {
          from: { strokeDashoffset: 74 },
          to: { strokeDashoffset: 0 },
        },
        "& polyline": {
          strokeDasharray: "14 60",
          strokeDashoffset: 74,
          animation: "agentPulseTrace 1.6s linear infinite",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& polyline": {
            animation: "none",
            strokeDasharray: "none",
            strokeDashoffset: 0,
          },
        },
      }}
    >
      <svg
        width="42"
        height="14"
        viewBox="0 0 42 14"
        aria-hidden
        style={{ flexShrink: 0, display: "block" }}
      >
        <polyline
          points="0,7 8,7 11,2 15,12 19,7 27,7 30,4 34,10 38,7 42,7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Typography
        variant="caption"
        sx={{ color: "inherit", whiteSpace: "nowrap" }}
      >
        {label}
      </Typography>
    </Stack>
  );
}
