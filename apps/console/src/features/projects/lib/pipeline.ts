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

// Validation vocabulary, shared by every surface that reports a verdict — the
// deploy leg of the overview track, the deployments board, the validation page.
//
// The three stage-view builders that used to live here went with the overview's
// stage cards: the track derives its own lines (`track.ts`), because the card
// grammar they were written for no longer exists. What stayed is the part that
// was never about the cards.
export type StageTone = "ghost" | "neutral" | "info" | "warning" | "success" | "error";

// The verdicts the loop repeats — delivery.ValidationVerdictFailsRun in the
// console's terms. Every other verdict is final until something re-asks it, so
// `awaiting-fix` beside one of those can only be poll skew.
const VALIDATION_REPEATED = new Set(["failed", "unreported"]);

/**
 * The validation state to RENDER, from the two facts the console holds separately:
 * `deploy.validation` (the loop's position, the only source of `running` and
 * `awaiting-fix`) and the run row's stored verdict (the last attempt's answer).
 *
 * Both are needed because neither is sufficient. `RunValidation.verdict` is a
 * COLUMN — six verdicts, no lifecycle — so a page reading it alone renders a fatal
 * verdict as terminal while the platform is repairing it and about to validate
 * again. deploy.validation carries the lifecycle but is scoped to the newest
 * validating run on the deploy version's milestone, so the run story a page keyed
 * itself on is the better source for the verdict itself.
 *
 * They are also two separate polls, so they can disagree by one interval. A
 * lifecycle value is therefore honoured only over a verdict the loop actually
 * repeats: a stale `awaiting-fix` beside a green verdict from the newer poll reads
 * as the verdict, not as a repair of something that passed.
 */
export function validationState(deployValidation: string, verdict: string): string {
  // `running` wins over ANY verdict, including a green one. It means a validation
  // cycle is genuinely in flight, which no verdict can be stale about — and a
  // revalidation is exactly that over a settled result, so guarding it would leave
  // the chip reading "Validated" while the platform re-asks the question. The poll
  // skew this once guarded against is one interval of a merely stale "Validating",
  // where a revalidation mislabelled is persistent.
  if (deployValidation === "running") return deployValidation;
  // `awaiting-fix` keeps the guard: it can only sit over a verdict the loop repeats,
  // so pairing it with a green one is skew by definition, not a state.
  if (
    deployValidation === "awaiting-fix" &&
    (verdict === "" || VALIDATION_REPEATED.has(verdict))
  ) {
    return deployValidation;
  }
  return verdict;
}

// validationView maps deploy.validation to a label + tone, shared by the overview
// deploy line (suffix) and the deployments board chip. null = nothing to show yet.
//
// deploy.validation MIRRORS the run's verdict rather than folding it, so this is a
// one-to-one rename into human words with nothing discarded on the way. That is
// what lets every label name the outcome instead of naming an artifact the reader
// would have to open to find the outcome out — the failing of the old vocabulary,
// where "completed" covered a green run and a red one alike.
//
// `spoken` is the accessible name for the two labels that carry their meaning in
// PUNCTUATION — "validated*" and "validation?". Screen readers do not announce
// either mark, so both would collapse onto a neighbouring state's name ("Validated",
// "Validation") and the distinction the vocabulary exists for would be sighted-only.
// It is absent everywhere else, so the default stays "the name is the visible label"
// and a caller that ignores the field is still correct for eight of the ten states.
//
// It is never the VISIBLE string. A caller with room says the hedge in its own prose
// (the verdict tile's sentence, the deployments banner's); a caller without room
// shows the mark. Substituting the spoken form for the label would put a third
// wording on screen and make the mark unreachable.
export function validationView(
  validation: string,
): { label: string; tone: StageTone; spoken?: string } | null {
  switch (validation) {
    // Two lifecycle values with something to say, both derived from the run's latest
    // CYCLE rather than from "the run is live and has no verdict" — that older rule
    // made the chip claim to be validating through every coding cycle of every run.
    // A validation cycle is in flight:
    case "running":
      return { label: "validating", tone: "info" };

    // A live run REPAIRING a failed validation. Deliberately terse and deliberately
    // silent about WHAT is being fixed: naming it costs a pill twice the width of its
    // neighbours, and the two surfaces a reader lands on next — the verdict tile and
    // the validation cycle's feed — both say it in full. What the label must not do is
    // imply validation is what's being repaired; the cycle in flight is ordinary coding
    // work on the defect validation found. Warning rather than error because the
    // verdict is real but not final: `error` belongs to the settled "validation failed"
    // below, and using it here would read as terminal while the platform is actively
    // resolving it.
    case "awaiting-fix":
      return { label: "awaiting fix", tone: "warning" };

    // The rest are the run's verdict verbatim, which is why each label can name
    // the outcome instead of naming an artifact to go and open.
    case "passed":
      return { label: "validated", tone: "success" };
    case "partial":
      // Something passed, nothing failed, and some criteria were never covered.
      //
      // The ASTERISK is the hedge and the TONE is the outcome, and separating them
      // is the point: nothing about this run failed, so green is honest, but the
      // bare word "validated" would claim a result for criteria nobody checked.
      // A spell-out ("partially validated") is not wanted here — the mark is meant
      // to be quiet, and the surfaces that have room say it in full a line later.
      //
      // `info` is NOT available for this, which is what makes the mark necessary
      // rather than merely nice: `running` is the only other info, and
      // deploymentStory's TONE_STATE maps info to `active` — the rail's hollow
      // pulsing dot. A settled partial verdict would pulse there forever.
      return { label: "validated*", tone: "success", spoken: "validated, partially" };
    case "failed":
      return { label: "validation failed", tone: "error" };
    case "inconclusive":
      // Nothing was automated, so nothing here is confirmed — and the question mark
      // is exactly that: the state has no answer to report, so the label poses the
      // question instead of dressing "we don't know" up as an outcome. "validation"
      // prefixes it because the chip is read on surfaces (the overview line, the
      // board) where the subject is otherwise the deployment.
      return {
        label: "validation?",
        tone: "warning",
        spoken: "validation inconclusive",
      };
    case "unreported":
      // No usable report at the validation cycle's merge commit, so the run learned
      // nothing. The label points at validation ITSELF having broken rather than at
      // anything the criteria concluded — no criterion produced a result here — and
      // leaves the tile's sentence to say what broke.
      return { label: "validation error", tone: "error" };
    case "skipped":
      // No criteria authored, so the run reached validation and passed over it.
      // Distinct from `none`, which is the run not having got here yet: this one is
      // settled, and its emptiness is a choice the project can revisit.
      return { label: "validation skipped", tone: "neutral" };
    case "cancelled":
      // A person stopped the judging before it produced a verdict. SETTLED, like
      // `skipped` and for the same reason — nothing is coming unless somebody
      // re-asks — which is why it is `neutral` rather than `info`: an `info` tone
      // maps to the rail's pulsing `active` dot, and this state would pulse there
      // forever. Nothing failed either, so an error tone would be a verdict the
      // run never reached.
      return { label: "validation cancelled", tone: "neutral" };

    default: // "none" | "" | unknown
      return null;
  }
}
