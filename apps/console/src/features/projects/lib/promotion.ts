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

// Promotion readiness — the Deployments page's "live configuration" model.
//
// A promotion collects PRODUCTION values for the design's connections: dev
// credentials never travel to another environment, so every connection that
// carries config keys has to be filled in again at the moment of promotion.
// The connection list is derived from the design-dependencies read the Spec
// view already uses (the console's single dependency-status read model) —
// promotion introduces no new contract surface. The VALUES have no backend
// yet (there is no promote endpoint in the contract), so they live in page
// state; this module is the pure derivation layer over both.

import type { components } from "../../../generated/aep-api";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];
type Dependency = components["schemas"]["Dependency"];
type ConfigKey = components["schemas"]["ConfigKey"];

/** One connection the promotion has to account for. */
export interface ConnectionRow {
  /** Dedupe identity — also the key entered values are stored under. */
  id: string;
  name: string;
  /** The dependency's kind — an "external" connection's values can be
   *  re-collected through collect-external-resource-values; a platform
   *  resource's cannot (the platform owns its credentials). */
  kind: string;
  /** The platform resource type ("postgres-cnpg"), shown beside the name. */
  detail?: string;
  /** The production values this connection needs; [] when there are none. */
  config: ConfigKey[];
  /** No values to collect — the platform provisions it in production. */
  provisioned: boolean;
}

/** Entered production values, keyed connection id → config key → value. */
export type ConnectionValues = Record<string, Record<string, string>>;

// The same dedupe identity the Spec view uses (dependencyUsedBy.ts /
// BuildDependencyDrawer's groupPreflightItems): a shared dependency is
// declared independently on every consuming component's design.json, and
// promotion must ask for its values once, not once per consumer.
function dependencyIdentity(dep: Dependency): string {
  return dep.kind === "platform-resource"
    ? `platform-resource:${dep.resourceType ?? ""}:${dep.name}`
    : `${dep.kind}:${dep.name}`;
}

/**
 * Every connection in the design, deduped across components, component-to-
 * component wiring excluded (an internal call edge has no production values —
 * the platform rewires siblings itself on promotion).
 */
export function connectionRows(
  all: ComponentDependencies[] | null | undefined,
): ConnectionRow[] {
  const byId = new Map<string, ConnectionRow>();
  for (const comp of all ?? []) {
    for (const dep of comp.dependencies ?? []) {
      if (dep.kind === "component") continue;
      const id = dependencyIdentity(dep);
      if (byId.has(id)) continue;
      const config = dep.config ?? [];
      byId.set(id, {
        id,
        name: dep.name,
        kind: dep.kind,
        ...(dep.resourceType && { detail: dep.resourceType }),
        config,
        provisioned: config.length === 0,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Initial values: a config key's defaultValue counts as already set. */
export function seedValues(rows: ConnectionRow[]): ConnectionValues {
  const values: ConnectionValues = {};
  for (const row of rows) {
    const entries = row.config.filter((k) => k.defaultValue);
    if (entries.length === 0) continue;
    values[row.id] = Object.fromEntries(
      entries.map((k) => [k.key, k.defaultValue ?? ""]),
    );
  }
  return values;
}

/** Does this connection have every production value it needs? */
export function connectionIsSet(
  row: ConnectionRow,
  values: ConnectionValues,
): boolean {
  return row.config.every((k) => (values[row.id]?.[k.key] ?? "").trim() !== "");
}

/** How many connections are ready (provisioned ones count — they need nothing). */
export function configuredCount(
  rows: ConnectionRow[],
  values: ConnectionValues,
): number {
  return rows.filter((row) => row.provisioned || connectionIsSet(row, values))
    .length;
}

/** Every connection accounted for — the promote gate. */
export function allConnectionsSet(
  rows: ConnectionRow[],
  values: ConnectionValues,
): boolean {
  return configuredCount(rows, values) === rows.length;
}

// Validation states that BLOCK promotion: a verdict still being earned (running /
// awaiting-fix), an outright red one (failed / unreported), and `none`.
//
// `none` is the one that reads like an exception and is not. It is NOT the absence
// of a verdict — it is the absence of one YET: the contract defines it as pending,
// meaning a run is live or a dev run filed the version's validation task and nothing
// has started judging it. Leaving it out is what lit this button up in the window
// between the dev deployment going green and the validation cycle starting, and
// through every coding cycle of a run whose earlier components were already serving.
// Both of those offer production a version nothing has checked.
//
// Everything else promotes. passed and partial on their merits. skipped and
// inconclusive because the question WAS asked and produced no verdict to wait for.
// `cancelled` because a person stopped the judging themselves — the only no-verdict
// state that is somebody's decision rather than an accident, and so the only one
// where "promote anyway" is theirs to make.
const BLOCKING_VALIDATION = new Set([
  "none",
  "running",
  "awaiting-fix",
  "failed",
  "unreported",
]);

/** Can this deploy state offer promotion at all? Dev must be live and validation
 *  must have had its say — a verdict that is still expected blocks, the same as a
 *  failing one. */
export function canPromote(deploy: {
  status: string;
  validation: string;
}): boolean {
  return deploy.status === "deployed" && !BLOCKING_VALIDATION.has(deploy.validation);
}
