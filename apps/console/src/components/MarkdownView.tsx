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

import Markdown from "react-markdown";
import { Box } from "@wso2/oxygen-ui";

// Console-wide markdown renderer for agent-authored content (skill bodies,
// alert diagnoses, and — later — agent chat messages). Styling is
// theme-token only so it holds up in light and dark; see design-system.md.
export function MarkdownView({ children }: { children: string }) {
  return (
    <Box
      sx={{
        color: "text.primary",
        fontSize: "0.875rem",
        lineHeight: 1.6,
        wordBreak: "break-word",
        "& h1, & h2, & h3, & h4": {
          mt: 2,
          mb: 1,
          fontWeight: 600,
          lineHeight: 1.3,
        },
        "& h1": { fontSize: "1.2rem" },
        "& h2": { fontSize: "1.05rem" },
        "& h3, & h4": { fontSize: "0.95rem" },
        "& p": { my: 1 },
        "& ul, & ol": { pl: 3, my: 1 },
        "& li": { mb: 0.5 },
        "& a": { color: "primary.main" },
        "& hr": { border: 0, borderTop: 1, borderColor: "divider", my: 2 },
        "& blockquote": {
          borderLeft: 3,
          borderColor: "divider",
          pl: 2,
          ml: 0,
          color: "text.secondary",
        },
        "& code": {
          fontFamily: "monospace",
          fontSize: "0.85em",
          px: 0.5,
          py: 0.25,
          borderRadius: 0.5,
          bgcolor: "action.hover",
        },
        "& pre": {
          p: 1.5,
          my: 1,
          borderRadius: 1,
          overflowX: "auto",
          bgcolor: "action.hover",
          "& code": { bgcolor: "transparent", p: 0 },
        },
        "& table": {
          borderCollapse: "collapse",
          my: 1,
          "& td, & th": {
            border: 1,
            borderColor: "divider",
            px: 1,
            py: 0.5,
            textAlign: "left",
          },
        },
        "& img": { maxWidth: "100%" },
      }}
    >
      <Markdown>{children}</Markdown>
    </Box>
  );
}
