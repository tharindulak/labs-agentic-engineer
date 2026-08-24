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
 * Validation for `ae_decline_issue`.
 *
 * Why a tool exists for declining at all: filing costs a tool call and is
 * therefore checkable, while declining used to cost nothing and was invisible
 * — the handoff simply ended its turn. `issue-fix` already demanded that a
 * decline enumerate `ruled_out` "one entry per remaining action" and claimed
 * "the mapping is checked", but there was nowhere to send that enumeration, so
 * the claim was a bluff and an unfiled defect was dropped for good.
 *
 * `hardeningRuledOut` is the field that does the real work. SKILL.md's test is
 * not "was this behaviour deliberate?" but "is there a change to the code that
 * would help and that does not contradict the spec?", and the observed failure
 * (report 59796491: a deliberate 8s delay tripping a 5s timeout, declined as
 * intended behaviour) is exactly that substitution. Requiring the caller to
 * name the hardening change it considered — and say why it contradicts the spec
 * — turns the test into something it has to answer rather than a caveat it can
 * skim past.
 *
 * The `case` values are constrained by the zod enum at the tool boundary, so
 * this function does not re-check them; it validates only what a well-typed
 * caller can still get wrong.
 */

/** The two cases SKILL.md allows a decline to rest on. */
export type RuledOutCase = "config-actionable" | "names-nothing-to-change";

export interface RuledOutEntry {
  /** The recommended action being ruled out, quoted from the RCA report. */
  action: string;
  case: RuledOutCase;
  /** Why that case applies to THIS action. */
  why: string;
  /**
   * The hardening change considered for this action, and why applying it would
   * contradict the spec. "As designed" is not an answer — see the module note.
   */
  hardeningRuledOut: string;
}

export interface DeclineInput {
  project: string;
  component?: string;
  /** The root cause being declined, so the record stands alone. */
  rootCause: string;
  ruledOut: RuledOutEntry[];
}

export type DeclineValidation = { ok: true } | { ok: false; error: string };

/**
 * Phrases that assert intent rather than argue it. Present on their own, they
 * are the failure mode this tool guards; alongside real reasoning they are
 * unremarkable, which is why the check measures what is LEFT after removing
 * them rather than rejecting on sight.
 */
const DELIBERATENESS = [
  "working as intended",
  "working as designed",
  "as designed",
  "as intended",
  "by design",
  "on purpose",
  "intentional",
  "intended",
  "deliberate",
  "expected behaviour",
  "expected behavior",
];

/** Placeholders that fill a required field without saying anything. */
const STUBS = new Set(["", "-", "--", "n/a", "na", "none", "nil", "tbd", "todo", "?", "."]);

const STOPWORDS = new Set([
  "the", "a", "an", "is", "was", "are", "were", "be", "this", "that", "it", "its",
  "and", "or", "but", "so", "to", "of", "in", "on", "for", "with", "here", "there",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/**
 * A field is substantive when it is not a placeholder and carries enough words
 * to be an argument. Four content words is deliberately a low bar: the point is
 * to stop "n/a" and "see above", not to grade prose.
 */
function unsubstantive(text: string): boolean {
  const trimmed = text.trim();
  if (STUBS.has(trimmed.toLowerCase())) {
    return true;
  }
  return contentWords(trimmed).length < 4;
}

/** True when the text says only that the behaviour was intended. */
function onlyAssertsDeliberateness(text: string): boolean {
  const lower = text.toLowerCase();
  if (!DELIBERATENESS.some((p) => lower.includes(p))) {
    return false;
  }
  let stripped = lower;
  for (const phrase of DELIBERATENESS) {
    stripped = stripped.split(phrase).join(" ");
  }
  return contentWords(stripped).length < 4;
}

/**
 * validateDecline reports whether a decline justifies itself. Every offending
 * entry is named by index in one message: a caller fixing a multi-action
 * decline should need one more turn, not one per problem.
 */
export function validateDecline(input: DeclineInput): DeclineValidation {
  if (input.ruledOut.length === 0) {
    return {
      ok: false,
      error:
        "a decline must justify itself: ruledOut needs one entry per remaining action in the report's " +
        "recommended actions. File the issue instead if you cannot account for one of them.",
    };
  }

  const problems: string[] = [];
  input.ruledOut.forEach((entry, i) => {
    const at = `ruledOut[${i}]`;
    if (entry.action.trim() === "") {
      problems.push(`${at}.action is required — quote the recommended action this entry rules out`);
    }
    for (const field of ["why", "hardeningRuledOut"] as const) {
      const value = entry[field];
      if (value.trim() === "") {
        problems.push(
          field === "hardeningRuledOut"
            ? `${at}.hardeningRuledOut is required — name the hardening change you considered and why it contradicts the spec`
            : `${at}.why is required — say why this case applies to this action`,
        );
        continue;
      }
      if (unsubstantive(value)) {
        problems.push(`${at}.${field} must be substantive, not a placeholder`);
        continue;
      }
      if (onlyAssertsDeliberateness(value)) {
        problems.push(
          `${at}.${field} only asserts the behaviour was deliberate. That is not the test — ` +
            "as-designed behaviour can still be hardened. Name a code change that would help and " +
            "say why it would contradict the spec, or file the issue.",
        );
      }
    }
  });

  if (problems.length > 0) {
    return { ok: false, error: problems.join("; ") };
  }
  return { ok: true };
}
