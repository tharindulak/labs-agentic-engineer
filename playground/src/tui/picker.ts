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
 * Project directory picker: recent projects + "open directory…" (§7). The
 * path prompt shows an EXPLICIT editable default (`playground/projects/my-app`
 * under the invocation dir — Enter accepts it); emptiness is checked before
 * expansion (a bare `resolve("")` is the cwd, which once made empty input
 * silently target the playground package); illegal repo-internal paths are
 * rejected in-picker (paths.ts is the single fence); a missing directory is
 * offered for creation.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import * as clack from "@clack/prompts";
import { listRecentProjects } from "../state/project.js";
import { defaultProjectDir, expandProjectPath, projectDirError } from "../paths.js";

const OPEN = "\0open";
const QUIT = "\0quit";

/** Pick a project dir, or null to exit. First run confirms the exact directory (§12). */
export async function pickProject(): Promise<string | null> {
  const recents = listRecentProjects();
  if (recents.length > 0) {
    const choice = await clack.select({
      message: "Pick a project",
      options: [
        ...recents.map((p) => ({ value: p, label: p })),
        { value: OPEN, label: "＋ Open directory…" },
        { value: QUIT, label: "Quit" },
      ],
    });
    if (clack.isCancel(choice) || choice === QUIT) return null;
    if (choice !== OPEN) return choice;
  }

  const dir = await clack.text({
    message: "Project directory (created if missing; Enter accepts the default)",
    initialValue: defaultProjectDir(),
    validate: (v) => {
      const raw = (v ?? "").trim();
      if (raw === "") return "enter a path"; // BEFORE expand — resolve("") is the cwd
      const p = expandProjectPath(raw);
      const fenceError = projectDirError(p);
      if (fenceError) return fenceError;
      if (existsSync(p) && !statSync(p).isDirectory()) return "exists but is not a directory";
      return undefined;
    },
  });
  if (clack.isCancel(dir)) return null;
  const path = expandProjectPath(dir.trim());

  if (!existsSync(path)) {
    const create = await clack.confirm({ message: `${path} does not exist. Create it?` });
    if (clack.isCancel(create) || !create) return null;
    mkdirSync(path, { recursive: true });
  }

  const confirmed = await clack.confirm({
    message: `The agents will read and WRITE inside ${path}. Continue?`,
  });
  if (clack.isCancel(confirmed) || !confirmed) return null;
  return path;
}
