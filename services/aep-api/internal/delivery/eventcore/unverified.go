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
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// unverifiedComment is posted on the issue the platform reopens. An issue that
// closes and reopens within seconds reads as a glitch unless something says
// otherwise, and the person who has to act on it is the one reading this.
const unverifiedComment = "The fix for this shipped in the pull request above, but the coding agent " +
	"did **not** declare high confidence in it, so this issue is left open as an " +
	"unverified fix rather than closed.\n\n" +
	"Nothing is working it and it does not hold up the version. If the fix is good, " +
	"close this issue. If the incident happens again, the platform reopens this same " +
	"thread with the new evidence and puts the coding agent back on it."

// keepUnverifiedIssuesOpen undoes GitHub's close for an incident fix nobody
// vouched for, leaving each issue open and OUT of the working set.
//
// Why it runs on the merged webhook rather than beside the merge call: a human
// merging the pull request in GitHub reaches only this path, and a fix merged by
// hand is no more verified than one merged by the policy. Deriving the decision
// here from the pull request body means both routes get the same treatment
// without the policy having to be consulted twice.
//
// Ordering note: GitHub processes the closing keywords as part of the merge, so
// by the time this delivery arrives the issues are already closed and the reopen
// is the last write. The reverse order would be a race — reopening an issue
// GitHub has not closed yet just gets closed a moment later.
//
// Every failure is a logged no-op. The merge has happened and the build is
// already going; an issue that stays closed is a worse record but not a broken
// one, and the recurrence path reopens it from the closed side anyway.
func (e *Events) keepUnverifiedIssuesOpen(ctx context.Context, orgID, projectID string, prNumber int, resolves []int) {
	if e.p.Issues == nil {
		return
	}
	for _, number := range resolves {
		issue, err := e.p.Issues.GetIssue(ctx, orgID, projectID, number)
		if err != nil || issue == nil {
			slog.WarnContext(ctx, "eventcore: could not read a resolved issue to leave it unverified",
				"issue", number, "pr", prNumber, "error", err)
			continue
		}
		// Only incident work. A spec-build issue resolved by the same pull
		// request is ordinary work and closes exactly as it always has.
		if !delivery.HasLabel(issue.Labels, sourcecontrol.LabelSREAgent) {
			continue
		}
		// Order matters within the issue too: drop the label BEFORE reopening.
		// Reopening first would briefly present an open `aep` issue to the
		// dispatch predicate, and a run at a cycle boundary in that window would
		// dispatch an agent onto work that is already merged.
		if err := e.p.Issues.RemoveLabel(ctx, orgID, projectID, number, delivery.LabelAgentWork); err != nil {
			slog.WarnContext(ctx, "eventcore: could not unmark a merged unverified issue as agent work",
				"issue", number, "pr", prNumber, "error", err)
			continue
		}
		if err := e.p.Issues.ReopenIssue(ctx, orgID, projectID, number); err != nil {
			slog.WarnContext(ctx, "eventcore: could not reopen a merged unverified issue",
				"issue", number, "pr", prNumber, "error", err)
			continue
		}
		if err := e.p.Issues.CommentIssue(ctx, orgID, projectID, number,
			fmt.Sprintf("%s\n\n_Pull request #%d._", unverifiedComment, prNumber)); err != nil {
			slog.WarnContext(ctx, "eventcore: could not explain an unverified reopen",
				"issue", number, "pr", prNumber, "error", err)
		}
		slog.InfoContext(ctx, "eventcore: incident fix merged unverified — its issue stays open",
			"issue", number, "pr", prNumber, "project", projectID)
	}
}

// unverifiedMerge reports whether a merged pull request was an incident fix that
// nobody vouched for. It re-derives the answer from the body rather than
// carrying the policy's verdict across, because the human-merge route never
// consults the policy at all.
func unverifiedMerge(body string) bool {
	return len(parseResolvesRefs(body)) > 0 && !declaresHighConfidence(body)
}
