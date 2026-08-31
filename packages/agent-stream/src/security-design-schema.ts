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
 * Runtime validation for the AUTHORED `specs/design/security.json`
 * (`SecurityDesign` in `./contracts/security-design.ts` — the wire source of
 * truth; the Zod schema below is drift-guarded against it). The FileBundle
 * calls `checkSecurityDesign` on every write to that path, so the model gets a
 * one-round-trip self-correction instead of a build gate rejecting the file
 * three steps later.
 *
 * The schema is also published as JSON Schema (`./json-schema.ts`) and vendored
 * into the BFF, so the agent's write-gate and the platform's save-gate validate
 * ONE definition.
 *
 * **Referential rules the JSON Schema cannot express** — every `testUsers[].role`
 * and `coldStartRole` naming a declared role, unique role names, unique
 * usernames, and thunder scopes tokens — live in `checkSecurityReferences`
 * below and are applied by BOTH sides separately, exactly like
 * `checkComponentDesign`'s name==directory rule.
 */

import { z } from "zod";
import type {
  SecurityDesign,
  RoleDeclaration,
  RolePermission,
  TestUserDeclaration,
  ThunderClient,
} from "./contracts/security-design.js";
import type { Equal } from "./type-equal.js";

/**
 * A test-user username, as the IdP will hold it. Lowercase-only so an authored
 * name and a platform-generated `test-<role-slug>` cannot collide by case
 * alone, and restricted to characters that survive a URL path segment.
 */
export const TEST_USERNAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

// strictObject everywhere, so an unknown key is rejected at author time. That is
// also what keeps a secret out of the file mechanically: there is no `password`
// property to write, at any nesting level, and the file is committed to git and
// pinned into the version tag.

const rolePermissionSchema = z.strictObject({
  component: z.string().min(1),
  actions: z.array(z.string().min(1)).optional(),
  screens: z.array(z.string().min(1)).optional(),
});

const roleSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  stories: z.array(z.number().int().positive()).min(1),
  grantedBy: z.string().min(1),
  permissions: z.array(rolePermissionSchema).min(1),
});

const testUserSchema = z.strictObject({
  username: z.string().min(1),
  role: z.string().min(1),
});

const thunderSchema = z.strictObject({
  name: z.string().min(1).max(100),
  type: z.literal("browser"),
  scopes: z.string().optional(),
});

export const securityDesignSchema = z.strictObject({
  version: z.literal(1),
  coldStartRole: z.string().min(1).nullable(),
  publicComponents: z.array(z.string().min(1)),
  roles: z.array(roleSchema).min(1),
  testUsers: z.array(testUserSchema),
  thunder: thunderSchema,
});

// Compile-time drift guards: schema ⇄ contracts wire types.
const _driftSecurity: Equal<z.infer<typeof securityDesignSchema>, SecurityDesign> = true;
const _driftRole: Equal<z.infer<typeof roleSchema>, RoleDeclaration> = true;
const _driftPermission: Equal<z.infer<typeof rolePermissionSchema>, RolePermission> = true;
const _driftTestUser: Equal<z.infer<typeof testUserSchema>, TestUserDeclaration> = true;
const _driftThunder: Equal<z.infer<typeof thunderSchema>, ThunderClient> = true;
void _driftSecurity;
void _driftRole;
void _driftPermission;
void _driftTestUser;
void _driftThunder;

/** Matches the one authored security document. */
export const SECURITY_DESIGN_JSON_RE = /^specs\/design\/security\.json$/;

export interface SecurityDesignProblem {
  code: "INVALID_JSON" | "SCHEMA_VIOLATION";
  message: string;
}

/**
 * The referential rules a standalone JSON Schema cannot express. Returns the
 * first violation phrased for self-correction, or null.
 *
 * Exported because the BFF applies the same list against the same parsed shape
 * — one rule set, two callers, never two hand-kept copies.
 */
export function checkSecurityReferences(doc: SecurityDesign): string | null {
  const declared = new Set<string>();
  for (const role of doc.roles) {
    const key = role.name.toLowerCase();
    if (declared.has(key)) {
      return `role "${role.name}" is declared twice — a role name is an identity on the shared directory, so it appears once.`;
    }
    declared.add(key);
    if (role.name !== role.name.trim()) {
      return `role "${role.name}" has leading or trailing whitespace — the name becomes the directory group name verbatim.`;
    }
    for (const perm of role.permissions) {
      if ((perm.actions?.length ?? 0) === 0 && (perm.screens?.length ?? 0) === 0) {
        return `role "${role.name}" grants nothing on component "${perm.component}" — give the entry "actions" (a service) or "screens" (a web application), or drop it.`;
      }
    }
  }

  if (doc.coldStartRole !== null && !declared.has(doc.coldStartRole.toLowerCase())) {
    return `coldStartRole "${doc.coldStartRole}" is not a declared role — name one of roles[].name, or null when a caller with no role reaches nothing.`;
  }

  const seenUsers = new Set<string>();
  for (const user of doc.testUsers) {
    if (!TEST_USERNAME_RE.test(user.username)) {
      return `test user "${user.username}" is not a usable directory username — use lowercase letters, digits, ".", "_" or "-", starting with a letter or digit.`;
    }
    if (seenUsers.has(user.username)) {
      return `test user "${user.username}" is listed twice.`;
    }
    seenUsers.add(user.username);
    if (!declared.has(user.role.toLowerCase())) {
      return `test user "${user.username}" holds role "${user.role}", which no roles[] entry declares.`;
    }
  }

  const thunderName = doc.thunder.name;
  if (thunderName !== thunderName.trim()) {
    return `thunder.name "${thunderName}" has leading or trailing whitespace.`;
  }
  if (thunderName.length < 1 || thunderName.length > 100) {
    return `thunder.name must be 1–100 characters.`;
  }

  const scopes = doc.thunder.scopes;
  if (scopes !== undefined && scopes.length > 0) {
    const tokens = scopes.split(/\s+/).filter((t) => t.length > 0);
    if (!tokens.includes("group")) {
      return `thunder.scopes must include the "group" token when scopes are set.`;
    }
    if (!tokens.includes("ou")) {
      return `thunder.scopes must include the "ou" token when scopes are set.`;
    }
  }

  return null;
}

/**
 * Validate a candidate security.json body for `path`. Returns null when the
 * path is not the security document or the content is valid; otherwise the
 * problem, phrased for the model's self-correction.
 */
export function checkSecurityDesign(path: string, content: string): SecurityDesignProblem | null {
  if (!SECURITY_DESIGN_JSON_RE.test(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      code: "INVALID_JSON",
      message: `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}. Re-emit the whole file.`,
    };
  }

  const res = securityDesignSchema.safeParse(parsed);
  if (!res.success) {
    const issues = res.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { code: "SCHEMA_VIOLATION", message: `${path} violates the SecurityDesign schema — ${issues}.` };
  }

  const refProblem = checkSecurityReferences(res.data);
  if (refProblem) {
    return { code: "SCHEMA_VIOLATION", message: `${path}: ${refProblem}` };
  }
  return null;
}
