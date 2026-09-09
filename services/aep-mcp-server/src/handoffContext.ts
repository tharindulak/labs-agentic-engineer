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

/**
 * What the CALLER'S PROCESS knows about an incident, as distinct from what its
 * model decided.
 *
 * The project, the component and the error signature are facts about the alert.
 * AE can confirm that a component exists in the design but not that it is the
 * one the alert fired on, and it verifies the org but not the project — so a
 * model-chosen name is a valid sibling filed under the wrong dedupe namespace,
 * with nothing downstream able to tell. They therefore arrive as per-run
 * headers, out of the model's reach, and win over the tool arguments.
 *
 * What this module DERIVES from them is AE's own contract: the dedupe key's
 * shape and the label set every SRE-filed issue carries. Whether the issue is
 * adopted is decided later by AE's create/adopt path, not by the caller's
 * prompt space.
 *
 * Nothing here fails a call. A handoff is one-shot — nothing retries it — so an
 * unreadable header costs a narrower dedupe key, never the incident.
 */

/** Per-run identity headers. Lower-case: Node lower-cases incoming header names. */
export const HEADER_PROJECT = "x-aep-incident-project";
export const HEADER_COMPONENT = "x-aep-incident-component";
export const HEADER_SIGNATURE = "x-aep-incident-signature";

/**
 * Applied to every issue filed through this server.
 *
 * `sre-agent` is load-bearing, not a human convenience: aep-api's recurrence
 * lookup queries GitHub with the dedupe label AND this one together
 * (internal/sourcecontrol/issue_service.go), so an issue filed without it drops
 * out of recurrence detection and a real recurrence reads as a first filing.
 * The authoritative name is `LabelSREAgent`, declared in
 * internal/sourcecontrol/issue_recurrence.go; this is the one copy TypeScript
 * cannot import, so a test in handoffContext.test.ts reads that declaration
 * out of the Go source and pins this copy against it.
 */
export const HANDOFF_LABELS: readonly string[] = ["bug", "sre-agent"];

/** Namespace for every dedupe key this server derives. */
const DEDUPE_PREFIX = "sre-rca";

/** Conservative identifier shape for a project or component name. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/**
 * The error fingerprint: a hex digest. Validated because it is interpolated
 * into a key namespace, and a caller-supplied header is not trusted input.
 */
const SIGNATURE = /^[a-z0-9]{1,64}$/;

export interface IncidentIdentity {
  project?: string;
  component?: string;
  signature?: string;
}

export interface ResolvedHandoff {
  project: string;
  componentName?: string;
  dedupeKey?: string;
  labels: string[];
  adopt: boolean;
  /** Human-readable lines for the caller to log. Which path was taken, and any header it could not use. */
  notes: string[];
}

/**
 * Extract and validate one identity header, rejecting an ambiguous repeat.
 *
 * `normalize` decides how the raw value is folded before the pattern check:
 * the signature is a hex digest, where case carries no meaning, so it is
 * lowercased for a stable dedupe key; the project and component names are
 * identifiers AE resolves against its own design, where case DOES carry
 * meaning (`Service1` is not `service1`), so they are only trimmed.
 */
function single(
  headers: NodeJS.Dict<string | string[]>,
  name: string,
  pattern: RegExp,
  notes: string[],
  normalize: (trimmed: string) => string,
): string | undefined {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    // Identity must be unambiguous: picking one of two would silently file the
    // incident against whichever arrived first.
    notes.push(`${name} arrived more than once and was ignored`);
    return undefined;
  }
  const value = normalize(raw.trim());
  if (!pattern.test(value)) {
    notes.push(`${name} is not a valid value and was ignored`);
    return undefined;
  }
  return value;
}

const asIs = (trimmed: string): string => trimmed;
const lower = (trimmed: string): string => trimmed.toLowerCase();

/**
 * Model-supplied tool arguments (unlike the identity headers, never checked
 * against `IDENTIFIER`) are interpolated verbatim into `notes` for logging.
 * Strip control characters — newlines above all — before that interpolation
 * so a value carrying one cannot forge an extra line in whatever ingests this
 * server's stderr. Only the logged text is sanitized; the real `project` /
 * `componentName` used for the actual API call are untouched.
 */
export function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them
  return value.replace(/[\x00-\x1f\x7f]/g, " ");
}

export function readIncidentIdentity(headers: NodeJS.Dict<string | string[]>): {
  identity: IncidentIdentity;
  notes: string[];
} {
  const notes: string[] = [];
  const identity: IncidentIdentity = {};
  const project = single(headers, HEADER_PROJECT, IDENTIFIER, notes, asIs);
  const component = single(headers, HEADER_COMPONENT, IDENTIFIER, notes, asIs);
  const signature = single(headers, HEADER_SIGNATURE, SIGNATURE, notes, lower);
  if (project !== undefined) identity.project = project;
  if (component !== undefined) identity.component = component;
  if (signature !== undefined) identity.signature = signature;
  return { identity, notes };
}

export function resolveHandoff(
  identity: IncidentIdentity,
  args: { project: string; componentName?: string; labels?: string[] },
  adopt: boolean,
): ResolvedHandoff {
  const notes: string[] = [];

  const project = identity.project ?? args.project;
  if (identity.project !== undefined && args.project !== identity.project) {
    // Worth a line even though the header wins: it is the only visible signal
    // that the caller's prompt-level scoping did not hold.
    notes.push(`project ${sanitizeForLog(args.project)} from the call was overridden by the incident header`);
  }

  const componentName = identity.component ?? args.componentName;
  if (identity.component !== undefined && args.componentName !== undefined && args.componentName !== identity.component) {
    notes.push(`componentName ${sanitizeForLog(args.componentName)} from the call was overridden by the incident header`);
  }

  const labels = [...(args.labels ?? [])];
  for (const label of HANDOFF_LABELS) {
    if (!labels.includes(label)) labels.push(label);
  }

  const resolved: ResolvedHandoff = { project, labels, adopt, notes };
  if (componentName !== undefined) {
    resolved.componentName = componentName;
    resolved.dedupeKey = identity.signature
      ? `${DEDUPE_PREFIX}/${componentName}/${identity.signature}`
      : `${DEDUPE_PREFIX}/${componentName}`;
  }
  return resolved;
}
