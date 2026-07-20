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
 * Headless phase commands (docs/design/playground.md §7): every TUI screen is
 * also a CLI verb with meaningful exit codes, so an edit-skill → rerun loop is
 * scriptable. Each command opens a session, runs its turn(s), and reports a
 * `PhaseOutcome` the CLI maps to an exit code.
 */

import { randomUUID } from "node:crypto";
import { stdout as output } from "node:process";
import { renderPart, renderSummary } from "@aep/agents/playground-kit";
import type { StreamPart } from "@aep/agent-stream";
import {
  composePlanInstruction,
  composeSpecInstruction,
  buildSpecGenerationInstruction,
  buildDesignGenerationInstruction,
} from "./engine/compose.js";
import { designGate, requirementsGate, tasksGate, type GateResult } from "./engine/gates.js";
import { openSession, type OpenOptions, type PlaygroundSession } from "./engine/session.js";
import { runSpecTurn, type SpecTurnResult } from "./engine/turn.js";
import { runCodingAgent } from "./engine/coding-run.js";
import { SKILLS_DIR } from "./engine/session.js";
import { blockedBy, FsIssueStore, type FoldOutcome } from "./ports/issue-store.js";
import { projectSlug } from "./ports/spec-workspace.js";
import { loadProjectState, readPrompt, savePrompt, saveProjectState } from "./state/project.js";
import { restoreUndoSnapshot, takeUndoSnapshot } from "./state/undo.js";

export interface PhaseOutcome {
  ok: boolean;
  detail?: string;
}

export interface PhaseOptions extends OpenOptions {
  /** `--target <x>` → production's `\n\n(target: x)` suffix. */
  target?: string;
  /** `--idea "<text>"` seeds/replaces the stored create prompt (requirements). */
  idea?: string;
  /** Quiet streaming (tests); default renders parts live. */
  silent?: boolean;
}

function onPartFor(opts: PhaseOptions): ((part: StreamPart) => void) | undefined {
  return opts.silent ? undefined : renderPart;
}

function report(result: SpecTurnResult, opts: PhaseOptions): PhaseOutcome {
  if (!opts.silent) {
    output.write("\n");
    renderSummary(result.changes, false);
    for (const n of result.derivedNotes) output.write(n.ok ? `  ⚙ ${n.message}\n` : `  ✗ ${n.message}\n`);
    for (const p of result.manifestMismatches) output.write(`  ⚠ manifest mismatch: ${p} (fold drift — please report)\n`);
  }
  if (result.error) return { ok: false, detail: result.error };
  return { ok: true };
}

function gateFail(gate: GateResult): PhaseOutcome {
  return { ok: false, detail: gate.reason ?? "blocked" };
}

/** Run one composed spec turn inside a fresh session (open → turn → close). */
async function runPhaseTurn(projectDir: string, instructionText: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const session = await openSession(projectDir, opts);
  try {
    const onPart = onPartFor(opts);
    const result = await runSpecTurn(session, composeSpecInstruction(instructionText, opts.target), {
      ...(onPart ? { onPart } : {}),
    });
    return report(result, opts);
  } finally {
    await session.close();
  }
}

/**
 * Phase 1 — requirements. The idea comes from `--idea`, the stored
 * `.aep-playground/prompt.md`, or (TUI) an interactive ask; the instruction is
 * the console's "Generate spec" CTA wrapping it (§5 phase 1).
 */
export async function requirementsCommand(
  projectDir: string,
  opts: PhaseOptions,
  askIdea?: () => Promise<string | null>,
): Promise<PhaseOutcome> {
  const gate = requirementsGate();
  if (!gate.ok) return gateFail(gate);

  let idea = opts.idea?.trim() || readPrompt(projectDir);
  if (!idea && askIdea) idea = (await askIdea())?.trim() || null;
  if (idea) savePrompt(projectDir, idea);

  return runPhaseTurn(projectDir, buildSpecGenerationInstruction(idea ?? null), opts);
}

/** Phase 2 — design, derived from the current requirements (§5 phase 2). */
export async function designCommand(projectDir: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const gate = designGate(projectDir);
  if (!gate.ok) return gateFail(gate);
  return runPhaseTurn(projectDir, buildDesignGenerationInstruction(), opts);
}

/**
 * Phase 3 — tasks (§5 phase 3): a fresh one-shot `task-plan` conversation on
 * the task-plan toolset; existing issues ride the INSTRUCTION (production
 * channel); OK tool-results fold into `issues/<n>.md` only after the terminal
 * manifest arrived.
 */
export async function tasksCommand(projectDir: string, opts: PhaseOptions): Promise<PhaseOutcome & { fold?: FoldOutcome }> {
  const gate = tasksGate(projectDir);
  if (!gate.ok) return gateFail(gate);

  const session = await openSession(projectDir, opts);
  try {
    const store = new FsIssueStore(projectDir, session.state.slug);
    const onPart = onPartFor(opts);
    const result = await runSpecTurn(session, composePlanInstruction(store.planContextFiles()), {
      useCase: "task-plan",
      conversationUuid: randomUUID(), // one-shot per plan turn (plan.go:223)
      toolset: "task-plan",
      foldToDisk: false,
      ...(onPart ? { onPart } : {}),
    });
    const fold = store.fold(
      result.parts,
      store.safeAllocator(
        () => session.state.nextIssueNumber,
        (advancedTo) => {
          session.state.nextIssueNumber = advancedTo;
        },
      ),
    );
    saveProjectState(projectDir, session.state);
    if (!opts.silent) {
      output.write("\n");
      for (const i of fold.created) output.write(`  ＋ ${i.file} — ${i.component}: ${i.title}\n`);
      for (const i of fold.updated) output.write(`  ± ${i.file} — ${i.component}: ${i.title}\n`);
      for (const t of fold.skippedDuplicates) output.write(`  ↷ duplicate skipped: ${t}\n`);
      for (const t of fold.skippedRenames) output.write(`  ↷ rename skipped (title already taken): ${t}\n`);
      if (fold.created.length + fold.updated.length === 0) output.write("  (no issues written)\n");
    }
    if (result.error) return { ok: false, detail: result.error, fold };
    return { ok: true, fold };
  } finally {
    await session.close();
  }
}

export interface CodeOptions extends PhaseOptions {
  /** `--restore`: restore the latest undo snapshot before this run. */
  restore?: boolean;
  /** Headless consent to run bypassPermissions on this directory (`--yes`). */
  yes?: boolean;
  /** Override the skills library / plugin (tests). */
  codingSkillsDir?: string;
  pluginDir?: string;
}

/**
 * Phase 4 — code (§5 phase 4; also the standalone requirement-2 entry).
 * Works on any dir with `specs/` + `issues/`: gate (issue parses), dependsOn
 * ordering WARNING (never a block), MANDATORY undo snapshot, spawn the
 * remote-worker local entry, stream its NDJSON, own the derivedStatus
 * write-back via exit codes.
 */
export async function codeCommand(
  projectDir: string,
  issueFile: string,
  opts: CodeOptions,
  confirmDir?: () => Promise<boolean>,
): Promise<PhaseOutcome> {
  const store = new FsIssueStore(projectDir, projectSlug(projectDir));
  const issue = store.list().find((i) => i.file === issueFile);
  if (!issue) return { ok: false, detail: `${issueFile} does not parse as a task (component + title frontmatter required)` };

  // First-run consent (§12): bypassPermissions writes THIS directory.
  const state = loadProjectState(projectDir, projectSlug(projectDir));
  if (!state.codingConfirmed && !opts.yes) {
    if (!confirmDir || !(await confirmDir())) {
      return { ok: false, detail: "coding run not confirmed — re-run with --yes or confirm in the TUI" };
    }
  }
  if (!state.codingConfirmed) {
    state.codingConfirmed = true;
    saveProjectState(projectDir, state);
  }

  // Ordering hint (§5 gate 1): dependsOn components whose issues aren't
  // deployed yet — warn, never block (the production "deployed" oracle is dropped).
  const notDeployed = blockedBy(issue, store.list());
  if (notDeployed.length > 0 && !opts.silent) {
    output.write(`  ⚠ dependsOn not deployed yet: ${notDeployed.join(", ")} (hint only — continuing)\n`);
  }

  if (opts.restore) {
    const restored = restoreUndoSnapshot(projectDir);
    if (!opts.silent) output.write(restored ? `  ↺ restored ${restored}\n` : "  (no undo snapshot to restore)\n");
  }
  const snapshot = takeUndoSnapshot(projectDir); // mandatory (§12)
  if (!opts.silent) output.write(`  ⛑ undo snapshot: ${snapshot}\n`);

  const result = await runCodingAgent({
    projectDir,
    issueFile,
    componentName: issue.component,
    skillsDir: opts.codingSkillsDir ?? SKILLS_DIR,
    ...(opts.pluginDir ? { pluginDir: opts.pluginDir } : {}),
    ...(opts.silent ? { silent: true } : {}),
  });
  if (!opts.silent) {
    output.write(`\n  issue ${issue.issueNumber} → ${result.exitCode === 0 ? "deployed" : "failed"}\n`);
    output.write(`  transcript: ${result.runDir}\n`);
  }
  return result.exitCode === 0 ? { ok: true } : { ok: false, detail: `coding run exited ${result.exitCode}` };
}

/**
 * `play code` with no issue argument — execute the WHOLE plan in one go
 * (§5 phase 4): every non-deployed issue in dependency order. Status is
 * re-read between runs, so a dependent started later in the same batch sees
 * the dep its predecessor just deployed. An issue whose dependsOn component
 * has a non-deployed issue at its turn is SKIPPED (its dep failed earlier in
 * the batch) — never a hard error, and independent branches still run.
 */
export async function codeAllCommand(
  projectDir: string,
  opts: CodeOptions,
  confirmDir?: () => Promise<boolean>,
): Promise<PhaseOutcome> {
  const store = new FsIssueStore(projectDir, projectSlug(projectDir));
  const plan = FsIssueStore.executionOrder(store.list()).filter((i) => i.derivedStatus !== "deployed");
  if (plan.length === 0) return { ok: false, detail: "nothing to run — no non-deployed issues (plan tasks first?)" };
  if (!opts.silent) {
    output.write(`  ▸ executing ${plan.length} task(s) in dependency order: ${plan.map((i) => `#${i.issueNumber}`).join(" → ")}\n`);
  }

  // `--restore` applies ONCE, before the batch. Each codeCommand below takes
  // its own undo snapshot; passing `restore` through would re-restore that
  // pre-issue snapshot on every iteration, silently wiping the work each
  // earlier issue just landed.
  if (opts.restore) {
    const restored = restoreUndoSnapshot(projectDir);
    if (!opts.silent) output.write(restored ? `  ↺ restored ${restored}\n` : "  (no undo snapshot to restore)\n");
  }
  const perRunOpts: CodeOptions = { ...opts, restore: false };

  let failed = 0;
  let skipped = 0;
  for (const issue of plan) {
    // Fresh status: earlier runs in this batch may have deployed our deps.
    const current = new FsIssueStore(projectDir, projectSlug(projectDir)).list();
    const blocked = blockedBy(issue, current);
    if (blocked.length > 0) {
      skipped += 1;
      if (!opts.silent) output.write(`  ↷ #${issue.issueNumber} ${issue.title} — skipped (dependsOn not deployed: ${blocked.join(", ")})\n`);
      continue;
    }
    if (!opts.silent) output.write(`\n  ▶ #${issue.issueNumber} [${issue.component}] ${issue.title}\n`);
    const outcome = await codeCommand(projectDir, issue.file, perRunOpts, confirmDir);
    if (!outcome.ok) {
      failed += 1;
      if (!opts.silent) output.write(`  ✗ #${issue.issueNumber} failed: ${outcome.detail ?? "unknown"}\n`);
      if (outcome.detail?.includes("not confirmed")) return outcome; // no consent — abort the batch
    }
  }

  const ran = plan.length - skipped;
  const summary = `${ran - failed}/${plan.length} deployed, ${failed} failed, ${skipped} skipped`;
  if (!opts.silent) output.write(`\n  ■ batch done: ${summary}\n`);
  return failed + skipped === 0 ? { ok: true } : { ok: false, detail: summary };
}

/** `play undo` — restore the latest pre-coding-run snapshot. */
export function undoCommand(projectDir: string, opts: PhaseOptions): PhaseOutcome {
  const restored = restoreUndoSnapshot(projectDir);
  if (!restored) return { ok: false, detail: "no undo snapshot found" };
  if (!opts.silent) output.write(`  ↺ restored ${restored}\n`);
  return { ok: true };
}

/** One free-chat turn in the project's `general` conversation (shared session). */
export async function chatTurn(session: PlaygroundSession, text: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const onPart = onPartFor(opts);
  const result = await runSpecTurn(session, composeSpecInstruction(text, opts.target), {
    ...(onPart ? { onPart } : {}),
  });
  return report(result, opts);
}
