// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package eventcore

import (
	"context"
	"errors"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// ADR-0029: a `bug` issue sourced `src/user` (explicit, or absent — the
// existing default) self-arms on the `bug` label alone, with no `aep` stamp
// required. Every other kind, and every other bug source, is untouched — see
// eligibleForAutoAdopt.
//
// The two comments below are the audit trail a human's own `aep` stamp
// otherwise carries for free (docs/glossary.md, "Arming label"): once a rule
// can arm an issue instead of a person, the issue timeline needs to keep
// saying so.
const (
	autoAdoptedComment = "🤖 Auto-adopted: the `bug` label on this user-reported " +
		"issue is its own arming (ADR-0029) — no `aep` label needed. It is now " +
		"armed for the coding agent, and the run over its milestone picks it up " +
		"at the next cycle boundary."
	autoAdoptNoDeployedVersionComment = "This looks like a user-reported bug, but " +
		"this project has no deployed version yet, so there is nothing to adopt " +
		"it into (ADR-0029). Once a version deploys, re-add the `bug` label (or " +
		"add `aep` directly) and it will be picked up."
)

// eligibleForAutoAdopt reports whether an issue's OWN label set is ADR-0029's
// self-arming population: a `bug`, sourced `src/user` or unsourced, that no
// human has already armed.
//
// An issue already carrying `aep` is left to the ordinary path. A human's own
// stamp already answers "who decided to spend money here"; self-arming it
// too would post a second, contradictory answer onto the same issue.
func eligibleForAutoAdopt(labels []string) bool {
	if delivery.KindOf(labels) != delivery.KindBug {
		return false
	}
	if delivery.HasLabel(labels, delivery.LabelAgentWork) {
		return false
	}
	return delivery.IsUserSourced(labels)
}

// AutoAdoptUserBug is OnIssues' self-arming route (ADR-0029). It shares every
// rule AdoptIssue already enforces — kind routing, milestone placement, the
// live-run no-op — and adds the two things a human's own `aep` stamp otherwise
// brings with it: the ARMING LABEL, and an audit trail marking the issue
// self-armed (or explaining why it could not be).
//
// It STAMPS `aep` because AdoptIssue deliberately does not (see its doc
// comment): the older routes into it carry a human's own authorisation already —
// the webhook route IS that human's `aep` stamp arriving — while this is the
// first route that adopts an issue guaranteed NOT to carry the label
// (eligibleForAutoAdopt requires its absence). Everything downstream of
// adoption reads that label and nothing else — delivery.InTaskWorkingSet, the
// milestone counts a cycle boundary polls, the reconcile sweep — so an issue
// adopted without it is a LEDGER issue by the platform's own definition: the run
// starts, its first poll counts no work, and it parks indefinitely holding the
// milestone's one live-run slot.
//
// The stamp goes FIRST, and the two writes are one act:
//
//   - Before, because the run AdoptIssue starts polls its milestone at the first
//     cycle boundary, and the platform's own label write comes back
//     echo-suppressed — a stamp landing after that poll is a stamp no run ever
//     sees, and nothing would wake it.
//   - Refusing when the stamp fails, because adopting anyway IS the parked-run
//     state above. Nothing is written and nothing is claimed on the issue.
//   - Rolling the stamp back when there is no deployed version to adopt into,
//     the one adoption outcome that writes nothing else: an armed issue in NO
//     milestone is invisible to every working set and to the sweep (which walks
//     milestones), and it would quietly falsify the comment's own advice, since
//     re-adding `bug` cannot self-arm an issue that already carries `aep`.
//
// Any OTHER error from AdoptIssue keeps the stamp and is logged and swallowed,
// the same as the `aep`-webhook route does: GitHub redelivering the label must
// not become a retry storm, the armed issue in its milestone is what lets the
// reconcile sweep finish the job, and a human watching the issue sees the
// comment (or its absence) rather than a delivery log.
//
// The caller gates on eligibleForAutoAdopt, which is also what makes a repeat
// pass inert: the stamp this route leaves is the "already handled" record, so a
// later delivery about the same issue is not eligible and the undeduped comment
// is not posted twice.
//
// The one error it does NOT swallow is a failed rollback: if there is no
// deployed version to adopt into AND the unlabel meant to undo the stamp also
// fails, the issue is left armed in no milestone — inert, but no longer
// self-arming, so the comment's own advice ("add `aep` directly") would be
// telling the reporter to do something already done. That failure is
// returned so the caller can fail the webhook delivery and let GitHub's
// redelivery retry the same idempotent unlabel, rather than posting a
// comment that would be wrong the moment it landed.
func (e *Events) AutoAdoptUserBug(ctx context.Context, orgID, projectID string, target AdoptTarget) error {
	if lerr := e.p.Writer.Label(ctx, orgID, projectID, target.Number, delivery.LabelAgentWork); lerr != nil {
		slog.WarnContext(ctx, "eventcore: auto-adopt declined — could not arm the issue",
			"issue", target.Number, "error", lerr)
		return nil
	}
	// The label AdoptIssue and every later reader must agree on. It routes on this
	// set (delivery.AdoptableByATaskRun), and a set that says the issue is unarmed
	// while the host says it is armed is the disagreement this whole route turns on.
	if !delivery.HasLabel(target.Labels, delivery.LabelAgentWork) {
		target.Labels = append(append([]string(nil), target.Labels...), delivery.LabelAgentWork)
	}

	err := e.AdoptIssue(ctx, orgID, projectID, target)
	var comment string
	switch {
	case err == nil:
		comment = autoAdoptedComment
	case errors.Is(err, ErrNoDeployedMilestone):
		if uerr := e.p.Writer.Unlabel(ctx, orgID, projectID, target.Number, delivery.LabelAgentWork); uerr != nil {
			slog.WarnContext(ctx, "eventcore: could not disarm an issue nothing adopted — leaving it for redelivery to retry",
				"issue", target.Number, "error", uerr)
			return uerr
		}
		comment = autoAdoptNoDeployedVersionComment
	default:
		slog.WarnContext(ctx, "eventcore: auto-adopt declined", "issue", target.Number, "error", err)
		return nil
	}
	if cerr := e.p.Writer.Comment(ctx, orgID, projectID, target.Number, comment); cerr != nil {
		slog.WarnContext(ctx, "eventcore: auto-adopt comment failed", "issue", target.Number, "error", cerr)
	}
	return nil
}
