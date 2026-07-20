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
 * `play check` — the advisory validation half of the production build gate
 * (docs/design/playground.md §11): every component design.json against the
 * published schema (the same write-gate the service enforces mid-turn) and a
 * YAML parse of every openapi.yaml. Advisory: reports, never blocks a phase.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkComponentDesign } from "@aep/agent-stream";
import { listComponents } from "./gates.js";

export interface CheckFinding {
  path: string;
  ok: boolean;
  message: string;
}

export function checkProject(projectDir: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const components = listComponents(projectDir);
  if (components.length === 0) {
    return [{ path: "specs/design/components", ok: false, message: "no components — run the design phase first" }];
  }
  for (const name of components) {
    const designRel = `specs/design/components/${name}/design.json`;
    const designAbs = join(projectDir, designRel);
    if (!existsSync(designAbs)) {
      findings.push({ path: designRel, ok: false, message: "missing design.json" });
    } else {
      const problem = checkComponentDesign(designRel, readFileSync(designAbs, "utf8"));
      findings.push(
        problem === null
          ? { path: designRel, ok: true, message: "valid" }
          : { path: designRel, ok: false, message: problem.message },
      );
    }

    const openapiRel = `specs/design/components/${name}/openapi.yaml`;
    const openapiAbs = join(projectDir, openapiRel);
    if (existsSync(openapiAbs)) {
      try {
        const doc = parseYaml(readFileSync(openapiAbs, "utf8")) as unknown;
        const isObject = doc !== null && typeof doc === "object" && !Array.isArray(doc);
        findings.push(
          isObject
            ? { path: openapiRel, ok: true, message: "parses" }
            : { path: openapiRel, ok: false, message: "not a YAML mapping" },
        );
      } catch (e) {
        findings.push({ path: openapiRel, ok: false, message: `YAML parse failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }
  return findings;
}
