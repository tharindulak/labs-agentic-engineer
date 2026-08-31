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

import { describe, expect, it } from "vitest";
import { validationState, validationView } from "./pipeline";

describe("validationView", () => {
  it("none / empty / unknown → null (nothing to show)", () => {
    expect(validationView("none")).toBeNull();
    expect(validationView("")).toBeNull();
    expect(validationView("bogus")).toBeNull();
  });
  it("running → validating (info)", () => {
    expect(validationView("running")).toEqual({
      label: "validating",
      tone: "info",
    });
  });
  // The repairing state stays terse and says nothing about WHAT is being fixed — the
  // tile and the cycle feed say that in full. What it must not do is read as repairing
  // validation, when the cycle in flight is ordinary coding work on the defect
  // validation found. Warning, not error: the verdict is real but not final, and
  // sharing `failed`'s tone would read as terminal mid-repair.
  it("awaiting-fix → awaiting fix (warning, never error)", () => {
    expect(validationView("awaiting-fix")).toEqual({
      label: "awaiting fix",
      tone: "warning",
    });
    expect(validationView("awaiting-fix")?.tone).not.toBe(
      validationView("failed")?.tone,
    );
  });
  // deploy.validation MIRRORS the verdict, so every label names the outcome
  // rather than naming an artifact the reader would have to open to find it.
  it("passed → validated (success)", () => {
    expect(validationView("passed")).toEqual({
      label: "validated",
      tone: "success",
    });
  });
  it("failed → validation failed (error)", () => {
    expect(validationView("failed")).toEqual({
      label: "validation failed",
      tone: "error",
    });
  });
  // Something passed and nothing failed, but criteria were left uncovered. The
  // ASTERISK hedges and the TONE reports the outcome: green is honest because
  // nothing failed, while the bare word would claim a result for criteria nobody
  // checked. `info` is unavailable — `running` owns it, and deploymentStory maps it
  // to the rail's pulsing `active` dot, which a settled verdict must not get.
  it("partial → validated* (success), with a spoken form for the mark", () => {
    expect(validationView("partial")).toEqual({
      label: "validated*",
      tone: "success",
      spoken: "validated, partially",
    });
    expect(validationView("partial")?.tone).toBe(validationView("passed")?.tone);
  });
  it("inconclusive → validation? (warning)", () => {
    expect(validationView("inconclusive")).toEqual({
      label: "validation?",
      tone: "warning",
      spoken: "validation inconclusive",
    });
  });
  // A validation failure that fails the run — so error, not warning, and pointed at
  // validation itself rather than at anything the criteria concluded: no criterion
  // produced a result here.
  it("unreported → validation error (error)", () => {
    expect(validationView("unreported")).toEqual({
      label: "validation error",
      tone: "error",
    });
  });
  // Surfaced rather than folded into null: this run reached validation and passed
  // over it, where null means it has not got there yet.
  it("skipped → validation skipped (neutral)", () => {
    expect(validationView("skipped")).toEqual({
      label: "validation skipped",
      tone: "neutral",
    });
  });
  // `spoken` is opt-in, and that is what makes "the accessible name is the visible
  // label" the default: a state that gained one by accident would announce itself
  // differently from what it shows, for no reason a reader could see.
  it("carries a spoken form ONLY where a mark carries the meaning", () => {
    for (const v of ["running", "awaiting-fix", "passed", "failed", "unreported", "skipped"]) {
      expect(validationView(v)?.spoken, `${v} should not need a spoken form`)
        .toBeUndefined();
    }
    // The two whose labels differ from a neighbour's by punctuation alone.
    expect(validationView("partial")?.spoken).toBeTruthy();
    expect(validationView("inconclusive")?.spoken).toBeTruthy();
  });
  // Every value the contract can send must map to something — a new verdict that
  // silently rendered nothing would be invisible on every surface.
  it("maps every verdict the contract can send", () => {
    for (const v of [
      "running",
      "passed",
      "partial",
      "failed",
      "inconclusive",
      "unreported",
      "skipped",
    ]) {
      expect(validationView(v), `no mapping for ${v}`).not.toBeNull();
    }
  });
});

// The join the Validation page was missing. `RunValidation.verdict` is a COLUMN —
// six verdicts, no lifecycle — so a surface reading it alone renders `failed` as
// terminal while the platform is repairing it and about to validate again, which is
// exactly what the page did while the deployments board beside it read "awaiting
// fix" for the same run.
describe("validationState", () => {
  // The two values that exist ONLY on deploy.validation. Nothing else can supply
  // them: no run row and no cycle record ever carries either.
  it("takes the lifecycle from deploy.validation over a repeatable verdict", () => {
    expect(validationState("awaiting-fix", "failed")).toBe("awaiting-fix");
    expect(validationState("awaiting-fix", "unreported")).toBe("awaiting-fix");
    expect(validationState("running", "failed")).toBe("running");
  });

  it("takes the lifecycle when no verdict exists yet — the first attempt", () => {
    expect(validationState("running", "")).toBe("running");
  });

  // The verdict itself always comes from the run row, which the page scopes more
  // precisely than the status read does (deploy.validation answers for the newest
  // validating run on the DEPLOY version's milestone).
  it("keeps the run's verdict for every settled state", () => {
    for (const v of ["passed", "partial", "inconclusive", "failed", "unreported", "skipped"]) {
      expect(validationState(v, v), `${v} should pass straight through`).toBe(v);
    }
  });

  // The two are separate polls, so they can disagree by one interval. A lifecycle
  // value only means anything over a verdict the loop actually repeats — pairing a
  // stale `awaiting-fix` with the newer poll's green verdict would announce a repair
  // of something that passed.
  // `running` means a validation cycle is genuinely IN FLIGHT, which no verdict can
  // be stale about — and a revalidation is exactly that over a settled result, so
  // guarding it left the chip reading "Validated" while the platform re-asked.
  it("lets running win over any verdict, including a green one", () => {
    for (const v of ["passed", "partial", "inconclusive", "failed", "unreported", "skipped"]) {
      expect(validationState("running", v), `running lost to ${v}`).toBe("running");
    }
  });

  // `awaiting-fix` keeps the guard: it can only sit over a verdict the loop repeats,
  // so pairing it with a green one is poll skew by definition, not a state.
  it("ignores a stale awaiting-fix over a verdict the loop never repeats", () => {
    expect(validationState("awaiting-fix", "passed")).toBe("passed");
    expect(validationState("awaiting-fix", "partial")).toBe("partial");
    expect(validationState("awaiting-fix", "skipped")).toBe("skipped");
  });

  it("has nothing to say with neither half", () => {
    expect(validationState("none", "")).toBe("");
    expect(validationState("", "")).toBe("");
  });
});
