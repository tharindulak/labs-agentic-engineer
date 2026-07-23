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

import type { StatusTone } from "../../components/StatusChip";
import type { components } from "../../generated/aep-api";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];
type Classification = RcaAgentReport["classification"];

const LABEL: Record<string, string> = {
  "code-level": "Code-level",
  "config-level": "Config-level",
  mixed: "Mixed",
  none: "No action",
};

const TONE: Record<string, StatusTone> = {
  "code-level": "warning",
  "config-level": "success",
  mixed: "warning",
  none: "neutral",
};

// Plain-text label — for contexts where a Chip (a <div>) can't be nested,
// e.g. inside NotificationPanel.ItemMessage, which MUI renders as a <p>.
export function classificationLabel(classification?: Classification): string {
  if (!classification) return "";
  return LABEL[classification] ?? classification;
}

export function classificationTone(classification?: Classification): StatusTone {
  if (!classification) return "neutral";
  return TONE[classification] ?? "neutral";
}
