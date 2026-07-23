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
 * Parser for a component's `design.json`. Turns the raw file text into a
 * tolerant, UI-friendly model the React view can render without knowing the
 * schema. Intentionally permissive — generated designs may be partial drafts;
 * missing fields are omitted, unknown/platform-owned fields (exposesAPI,
 * componentAgentInstructions) are ignored, and a malformed file degrades to a
 * ParseError the view shows as an alert instead of throwing.
 *
 * A dependency's `style`/`package`/`candidates` ARE parsed here — they are
 * authored/derived intent, persisted in the raw file exactly like
 * `specPath`/`config` (packages/contracts/schemas/component-design.schema.json).
 * `status`/`reason` are the ONE exception: deliberately NOT modelled, because
 * they are read-time computed server-side (models.ComputeDependencyStatus,
 * #252 Task 2's `GET /projects/{p}/design/dependencies`) and never written to
 * this file — recomputing them from the fields above would drift from that
 * single resolution authority. DesignView's optional `dependencyStatus` prop
 * is the only source for them (see DesignView.tsx).
 */

export type DependencyKind =
  | "component"
  | "org-service"
  | "external"
  | "platform-resource";

export interface DesignConfigEntry {
  key: string;
  secret?: boolean;
}

/** One option in an ambiguous external dependency's resolution set (2+ when present). */
export interface DependencyCandidate {
  name: string;
  /** "rest-api" | "sdk"; kept as a raw string so an unknown style still renders. */
  style?: string;
  description?: string;
  package?: string;
}

export interface Dependency {
  /** The declared kind; kept as a raw string so an unknown kind still renders. */
  kind: DependencyKind | string;
  name: string;
  description?: string;
  /** external only: "rest-api" | "sdk", kept as a raw string. */
  style?: string;
  /** external (sdk style) only: ecosystem-prefixed package identifier. */
  package?: string;
  /** external only: stored contract location — a URL or a repo-relative path. */
  specPath?: string;
  /** external only: 2+ identified-but-not-pinned options (the "ambiguous" state). */
  candidates?: DependencyCandidate[];
  config?: DesignConfigEntry[];
  resourceType?: string;
  parameters?: Record<string, unknown>;
}

export interface DesignEndpoint {
  name: string;
}

export interface ComponentDesign {
  name: string;
  type: string;
  version: string;
  language: string;
  buildpack: string;
  appPath: string;
  entrypoint: string;
  exposure: string;
  description?: string;
  skillsApplied?: string[];
  endpoint?: DesignEndpoint;
  dependencies: Dependency[];
}

export interface ParseError {
  kind: "parse-error";
  message: string;
}

export type ParseResult = ComponentDesign | ParseError;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConfig(v: unknown): DesignConfigEntry[] {
  if (!Array.isArray(v)) return [];
  const out: DesignConfigEntry[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const key = str(item.key);
    if (!key) continue;
    const entry: DesignConfigEntry = { key };
    const secret = optBool(item.secret);
    if (secret !== undefined) entry.secret = secret;
    out.push(entry);
  }
  return out;
}

function parseCandidates(v: unknown): DependencyCandidate[] {
  if (!Array.isArray(v)) return [];
  const out: DependencyCandidate[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const candidate: DependencyCandidate = { name };
    const style = optStr(item.style);
    if (style) candidate.style = style;
    const description = optStr(item.description);
    if (description) candidate.description = description;
    const pkg = optStr(item.package);
    if (pkg) candidate.package = pkg;
    out.push(candidate);
  }
  return out;
}

function parseDependencies(v: unknown): Dependency[] {
  if (!Array.isArray(v)) return [];
  const out: Dependency[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const dep: Dependency = { kind: str(item.kind) || "unknown", name };
    const description = optStr(item.description);
    if (description) dep.description = description;
    const style = optStr(item.style);
    if (style) dep.style = style;
    const pkg = optStr(item.package);
    if (pkg) dep.package = pkg;
    const specPath = optStr(item.specPath);
    if (specPath) dep.specPath = specPath;
    const candidates = parseCandidates(item.candidates);
    if (candidates.length) dep.candidates = candidates;
    const resourceType = optStr(item.resourceType);
    if (resourceType) dep.resourceType = resourceType;
    const config = parseConfig(item.config);
    if (config.length) dep.config = config;
    if (isObject(item.parameters)) dep.parameters = item.parameters;
    out.push(dep);
  }
  return out;
}

export function parseComponentDesign(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { kind: "parse-error", message: (e as Error).message };
  }
  if (!isObject(data)) {
    return { kind: "parse-error", message: "design.json is not a JSON object" };
  }

  const design: ComponentDesign = {
    name: str(data.name),
    type: str(data.type),
    version: str(data.version),
    language: str(data.language),
    buildpack: str(data.buildpack),
    appPath: str(data.appPath),
    entrypoint: str(data.entrypoint),
    exposure: str(data.exposure),
    dependencies: parseDependencies(data.dependencies),
  };

  const description = optStr(data.description);
  if (description) design.description = description;

  if (Array.isArray(data.skillsApplied)) {
    const skills = data.skillsApplied.filter(
      (s): s is string => typeof s === "string",
    );
    if (skills.length) design.skillsApplied = skills;
  }

  if (isObject(data.endpoint)) {
    const epName = optStr(data.endpoint.name);
    if (epName) design.endpoint = { name: epName };
  }

  return design;
}
