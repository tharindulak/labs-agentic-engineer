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
 * One coding run (docs/design/playground.md §5 phase 4): spawn the
 * remote-worker's local entrypoint on an issue file, stream its NDJSON
 * progress contract into a live timeline, archive the run, and own the
 * `derivedStatus` write-back on exit codes — the playground CLI is the writer
 * of record (`deployed` on exit 0, `failed` otherwise), tolerant-repair
 * posture like production's taskmeta.Repair.
 *
 * Works on ANY directory containing `specs/` + `issues/` — no playground
 * state, no prior phases, no engineering-agent process (hard requirement 2).
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdout as output } from "node:process";
import { REPO_ROOT } from "../paths.js";

const LOCAL_ENTRY = join(REPO_ROOT, "runners", "remote-worker", "src", "local.ts");

export interface ProgressEvent {
  kind: string;
  phase?: string;
  tool?: string;
  summary?: string;
  status?: string;
  error?: string;
  level?: string;
  command?: string;
  sha?: string;
}

/** One NDJSON line → a formatted timeline line (docs §7 coding-run screen). */
export function renderProgressLine(e: ProgressEvent): string {
  switch (e.kind) {
    case "phase":
      return `  ▸ ${String(e.phase ?? "").replace(/_/g, " ")}`;
    case "tool_use":
      return `  ${e.tool === "Bash" ? "$" : "⚙"} ${e.summary || e.tool || "tool"}`;
    case "git_commit":
      return `  ✓ commit ${e.sha?.slice(0, 8) ?? ""} ${e.summary ?? ""}`.trimEnd();
    case "git_push":
      return `  ⚠ push attempted (local mode has no remote) ${e.summary ?? ""}`.trimEnd();
    case "gh_action":
      return `  ⚠ gh ${e.command ?? ""} (local mode has no GitHub)`.trimEnd();
    case "log":
      return `  ${e.level === "error" ? "✗" : e.level === "warn" ? "⚠" : "·"} ${e.summary ?? ""}`.trimEnd();
    case "result":
      return e.status === "success" ? "  ■ result success" : `  ■ result failure${e.error ? ` — ${e.error}` : ""}`;
    default:
      return `  · ${e.kind}`;
  }
}

export interface CodingRunOptions {
  projectDir: string;
  /** Project-relative issue file (e.g. `issues/3.md`). */
  issueFile: string;
  /** Component from the issue frontmatter. */
  componentName: string;
  /** Working-tree skills library dir; omit to run skill-free. */
  skillsDir?: string;
  /** Override the base plugin (defaults to remote-worker/plugin-local). */
  pluginDir?: string;
  silent?: boolean;
}

export interface CodingRunResult {
  exitCode: number;
  runDir: string;
}

/** Read the issue file's current frontmatter `derivedStatus`, if any. */
export function readDerivedStatus(projectDir: string, issueFile: string): string | undefined {
  const abs = join(projectDir, issueFile);
  if (!existsSync(abs)) return undefined;
  return /^derivedStatus: *"?([^"\n]+)"?$/m.exec(readFileSync(abs, "utf8"))?.[1];
}

/** Set (or insert) the issue file's frontmatter `derivedStatus`. */
export function writeDerivedStatus(projectDir: string, issueFile: string, status: string): void {
  const abs = join(projectDir, issueFile);
  if (!existsSync(abs)) return;
  const text = readFileSync(abs, "utf8");
  let next: string;
  if (/^derivedStatus: .*$/m.test(text)) {
    next = text.replace(/^derivedStatus: .*$/m, `derivedStatus: "${status}"`);
  } else {
    // Insert after the origin line (production field order), or before the
    // closing fence as a fallback.
    next = /^origin: .*$/m.test(text)
      ? text.replace(/^(origin: .*)$/m, `$1\nderivedStatus: "${status}"`)
      : text.replace(/\n---\n/, `\nderivedStatus: "${status}"\n---\n`);
  }
  if (next !== text) writeFileSync(abs, next, "utf8");
}

/** Spawn one coding run; resolves with the exit code + archived run dir. */
export function runCodingAgent(opts: CodingRunOptions): Promise<CodingRunResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const issueNumber = /(\d+)\.md$/.exec(opts.issueFile)?.[1] ?? "x";
  const runDir = join(opts.projectDir, ".aep-playground", "runs", `${stamp}-code-issue-${issueNumber}`);
  mkdirSync(runDir, { recursive: true });
  const progressLog = createWriteStream(join(runDir, "progress.ndjson"), { flags: "w" });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AEP_LOCAL_PROJECT_DIR: opts.projectDir,
    AEP_LOCAL_ISSUE_FILE: opts.issueFile,
    AEP_COMPONENT_NAME: opts.componentName,
    AEP_LOCAL_RUN_DIR: runDir,
    ...(opts.skillsDir ? { AEP_LOCAL_SKILLS_DIR: opts.skillsDir } : {}),
    ...(opts.pluginDir ? { AEP_LOCAL_PLUGIN_DIR: opts.pluginDir } : {}),
  };

  // Mark the run in flight; the exit handler below is the writer of record.
  writeDerivedStatus(opts.projectDir, opts.issueFile, "running");

  return new Promise((resolvePromise) => {
    const child = spawn("npx", ["tsx", LOCAL_ENTRY], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        progressLog.write(line + "\n");
        if (opts.silent) continue;
        try {
          output.write(renderProgressLine(JSON.parse(line) as ProgressEvent) + "\n");
        } catch {
          output.write(`  ${line}\n`); // non-NDJSON runner logging — pass through
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!opts.silent) output.write(chunk.toString("utf8"));
    });

    const settle = (exitCode: number): void => {
      progressLog.end();
      // Writer of record for derivedStatus (tolerant repair): any nonzero
      // exit or kill → failed. Exit 0 normalizes to deployed UNLESS the
      // agent itself reported failed — the aep-local skill's give-up
      // protocol sets "failed" and still finishes the session successfully,
      // and that honest report must survive.
      const agentSet = readDerivedStatus(opts.projectDir, opts.issueFile);
      const status = exitCode !== 0 ? "failed" : agentSet === "failed" ? "failed" : "deployed";
      writeDerivedStatus(opts.projectDir, opts.issueFile, status);
      resolvePromise({ exitCode, runDir });
    };
    child.on("error", (err) => {
      if (!opts.silent) output.write(`  ✗ spawn failed: ${err.message}\n`);
      settle(2);
    });
    child.on("close", (code, signal) => {
      settle(signal ? 130 : (code ?? 2));
    });

    // Ctrl-C: kill the child; the close handler marks the run failed.
    const onInt = (): void => {
      child.kill("SIGTERM");
    };
    process.once("SIGINT", onInt);
    child.on("close", () => process.removeListener("SIGINT", onInt));
  });
}
