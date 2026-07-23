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

// The BE's canonical skill-kind vocabulary (`skills/skill_service.go`,
// `frontmatterKind`). `builtin` and `flow` are RETIRED: `repo_store.go`'s
// `legacyKindDirs` maps builtin→org and flow→platform for repos that predate
// the flat layout. The contract types `kind` as a bare string (issue #143
// proposes an enum), so normalise anything unrecognised to `org` — the same
// default the BE applies to an unmarked SKILL.md.
export const SKILL_KINDS = ["org", "platform", "custom", "imported"] as const;

export type SkillKind = (typeof SKILL_KINDS)[number];

export function normalizeKind(kind: string): SkillKind {
  return (SKILL_KINDS as readonly string[]).includes(kind)
    ? (kind as SkillKind)
    : "org";
}

export function kindLabel(kind: SkillKind): string {
  switch (kind) {
    case "org":
      return "Organization";
    case "platform":
      return "Platform";
    case "custom":
      return "Custom";
    case "imported":
      return "Imported";
  }
}

// Chip tone per kind (StatusChip). Two Oxygen Chip colours are deliberately
// avoided: `warning` belongs to the "update available" chip (a kind must not
// read as a state), and `secondary` resolves to a near-white (#e8e8e8) that
// is unreadable on a light surface.
export function kindChipTone(kind: SkillKind): StatusTone {
  switch (kind) {
    case "org":
      return "primary";
    case "platform":
      return "info";
    case "custom":
      return "success";
    case "imported":
      return "neutral";
  }
}

// One-line explanation per kind, shown as a tooltip on the row's kind chip
// (issue #172): the flat list has no group headings to carry it, and the
// org/platform blurbs are also where read-only-ness is stated — the list
// shows no separate read-only chip.
export function kindBlurb(kind: SkillKind): string {
  switch (kind) {
    case "org":
      return "Shipped with the platform. Read-only — view to inspect the body.";
    case "platform":
      return "Generation-flow guidance the platform agents follow (design, tasks, wireframes). Read-only.";
    case "custom":
      return "Authored by your organization.";
    case "imported":
      return "AgentSkills brought in from the ecosystem.";
  }
}
