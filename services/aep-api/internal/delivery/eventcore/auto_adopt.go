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
		"issue arms it for the coding agent (ADR-0029) — no `aep` label needed. " +
		"It has been moved into the deployed version's milestone and will be " +
		"picked up shortly."
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
// live-run no-op — and adds only the audit trail: a comment marking the
// issue self-armed, or explaining why it could not be.
//
// Errors from AdoptIssue other than ErrNoDeployedMilestone are logged and
// swallowed, the same as the `aep`-webhook route does: GitHub redelivering
// the label must not become a retry storm, and a human watching the issue
// sees the comment (or its absence) rather than a delivery log.
func (e *Events) AutoAdoptUserBug(ctx context.Context, orgID, projectID string, target AdoptTarget) {
	err := e.AdoptIssue(ctx, orgID, projectID, target)
	var comment string
	switch {
	case err == nil:
		comment = autoAdoptedComment
	case errors.Is(err, ErrNoDeployedMilestone):
		comment = autoAdoptNoDeployedVersionComment
	default:
		slog.WarnContext(ctx, "eventcore: auto-adopt declined", "issue", target.Number, "error", err)
		return
	}
	if cerr := e.p.Writer.Comment(ctx, orgID, projectID, target.Number, comment); cerr != nil {
		slog.WarnContext(ctx, "eventcore: auto-adopt comment failed", "issue", target.Number, "error", cerr)
	}
}
