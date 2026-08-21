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
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// AdoptTarget is the issue being handed to the coding agent, plus the
// milestone it already belongs to (0 when it is a bare issue). The webhook
// path reads both out of the payload — every issues delivery embeds the full
// issue — so adoption costs no extra GitHub read.
type AdoptTarget struct {
	Number          int
	MilestoneNumber int
	MilestoneTitle  string
}

// AdoptIssue hands an issue that ALREADY EXISTS to the coding agent: the
// `aep:codingagent` label arriving by webhook, and any caller that adopts an
// issue by number directly (a label the platform stamps itself comes back as an
// echo and is dropped, so a direct caller cannot rely on the webhook).
//
// Its sibling AdoptOnCreate below is the other direction — the caller filing the
// issue asks for it in the same breath.
//
// The rules, in order:
//
//   - An issue that already has a milestone keeps it. The human put it there.
//   - A bare issue joins the milestone of the version it is an incident
//     against: the deployed one, or — when nothing has been deployed yet — the
//     spec build currently in flight. With neither, the caller gets
//     delivery.ErrNoAdoptableMilestone rather than a guess.
//   - Adoption STAMPS the agent-work label. See below.
//   - If a run is already live on that milestone, no second run starts —
//     that would put two agents on one branch. The live run is woken instead,
//     because a run parked on an empty working set has no other way to learn
//     that work arrived.
//   - Otherwise an incident run starts over that milestone.
//
// Adoption stamps delivery.LabelAgentWork because the working set is the
// milestone's `aep`-labelled issues (MilestoneIssueCounts.OpenNonGateWork), so
// an adopted issue without it is invisible to the dispatch predicate: the run
// starts, finds nothing to work, and parks forever. Membership of the milestone
// is NOT sufficient on its own — ledger issues live there too, which is the
// distinction the label exists to draw.
//
// This does not blur who adopted the issue. `aep:codingagent` records the act
// of adoption and survives untouched; `aep` records the consequence — that the
// issue is now agent work. Two facts, two labels, and the second is the
// platform's to write precisely because it is derived from the first.
func (e *Events) AdoptIssue(ctx context.Context, orgID, projectID string, target AdoptTarget) error {
	if target.Number == 0 || e.p.Runs == nil {
		return nil
	}
	milestone := MilestoneRef{Number: target.MilestoneNumber, Title: target.MilestoneTitle}
	if milestone.Number == 0 {
		resolved, err := e.adoptableMilestone(ctx, orgID, projectID)
		if err != nil {
			return err
		}
		milestone = *resolved
		if e.p.Issues != nil {
			if err := e.p.Issues.SetIssueMilestone(ctx, orgID, projectID, target.Number, milestone.Number); err != nil {
				return err
			}
		}
		slog.InfoContext(ctx, "eventcore: adopted a bare issue into a version's milestone",
			"issue", target.Number, "milestone", milestone.Number, "version", milestone.Title)
	}

	// Before any run is started or woken: an issue that is not agent work would
	// send it straight back to an empty working set.
	if e.p.Issues != nil {
		if err := e.p.Issues.AddLabels(ctx, orgID, projectID, target.Number, []string{delivery.LabelAgentWork}); err != nil {
			return fmt.Errorf("adopt issue %d: mark as agent work: %w", target.Number, err)
		}
	}

	return e.startOrWake(ctx, orgID, projectID, milestone)
}

// CreateAdoptResult is what AdoptOnCreate did. Adopted answers the only
// question the caller cannot work out for itself — will anything work this
// issue? — and Reason carries why not, when it will not.
type CreateAdoptResult struct {
	Issue   *sourcecontrol.IssueResult
	Adopted bool
	// Reason is empty when Adopted is true. Otherwise it is the refusal in
	// words, for the caller to relay: nothing retries an adoption, so a caller
	// that cannot see why it did not happen cannot act on it either.
	Reason string
}

// AdoptOnCreate files an issue that is agent work FROM THE MOMENT IT EXISTS.
// It is AdoptIssue's sibling, for the other direction: AdoptIssue takes an
// issue somebody already filed and hands it over, while this one is asked for
// by the caller filing it.
//
// The difference is not cosmetic. Adoption after the fact needs two more GitHub
// writes — the milestone and the agent-work label — and an issue that survives
// the first write but not the second is filed, in a milestone, and invisible to
// the run that is supposed to work it. Here the milestone and both labels ride
// the CREATE call, so there is no state between them to be left half-written.
// Everything after that write is recoverable by the reconcile sweep, whose rule
// is exactly this issue's situation: a milestone with open work and no live run
// gets one.
//
// The rules it shares with AdoptIssue, because they are adoption's rules and
// not this path's: a bare issue joins the DEPLOYED version's milestone (or the
// spec build in flight, when nothing is deployed yet); LabelAgentWork is what
// makes it visible to the dispatch predicate; LabelAdopt records the act; and a
// milestone that already has a live run gets that run woken rather than a
// second one started.
//
// Refusals are answered, not raised. A project with no version to adopt into
// still gets its issue — as a ledger entry, with the reason — because nothing
// retries a handoff and dropping it loses the incident for good. componentName
// is the one thing that DOES refuse before writing: an unknown name means the
// caller's own naming is wrong (a project prefix left on, typically), and
// failing here is what stops it surfacing later inside a cycle.
func (e *Events) AdoptOnCreate(
	ctx context.Context,
	orgID, projectID, componentName string,
	req sourcecontrol.CreateIssueRequest,
) (*CreateAdoptResult, error) {
	if e.p.Issues == nil {
		return nil, fmt.Errorf("adopt on create: no issue client wired")
	}

	milestone, err := e.adoptableMilestone(ctx, orgID, projectID)
	if err != nil {
		if !errors.Is(err, delivery.ErrNoAdoptableMilestone) {
			// A read that failed for any other reason is a server fault, and the
			// caller may retry it. Filing first and failing after would leave a
			// duplicate behind on that retry for every caller without a dedupe key.
			return nil, err
		}
		issue, cerr := e.p.Issues.CreateIssue(ctx, orgID, projectID, req)
		if cerr != nil {
			return nil, cerr
		}
		slog.InfoContext(ctx, "eventcore: issue filed as a ledger entry — no version to adopt it into",
			"project", projectID, "issue", issue.Number)
		return &CreateAdoptResult{Issue: issue, Reason: err.Error()}, nil
	}

	// Before anything is written: a component the design does not carry cannot
	// be built, so refuse while refusing is still free.
	if componentName != "" && e.p.Components != nil {
		if cerr := e.p.Components.EnsureComponent(ctx, orgID, projectID, componentName); cerr != nil {
			return nil, fmt.Errorf("adopt on create: %w", cerr)
		}
	}

	req.Milestone = &milestone.Number
	req.Labels = appendMissingLabels(req.Labels, delivery.LabelAgentWork, delivery.LabelAdopt)

	issue, err := e.p.Issues.CreateIssue(ctx, orgID, projectID, req)
	if err != nil {
		return nil, err
	}
	if issue.Deduped {
		// The open issue this folded onto was adopted by the run that created it,
		// and that run owns its dispatch. Adopting again would be a no-op against
		// GitHub and a lie in the answer.
		slog.InfoContext(ctx, "eventcore: create deduped onto an open issue — its own run owns the dispatch",
			"project", projectID, "issue", issue.Number)
		return &CreateAdoptResult{
			Issue:  issue,
			Reason: "an open issue for the same dedupe key already exists and is already being worked",
		}, nil
	}

	// The issue is adopted from here on — it is in the milestone and carries the
	// agent-work label. A run that fails to start is therefore NOT an adoption
	// failure: the sweep finds a milestone with open work and no live run, and
	// starts one within its interval. Reporting a failure here would be wrong
	// twice over, since the issue is filed and the run is coming.
	if rerr := e.startOrWake(ctx, orgID, projectID, *milestone); rerr != nil {
		slog.WarnContext(ctx, "eventcore: adopted on create, but the run did not start — leaving it to the sweep",
			"project", projectID, "issue", issue.Number, "milestone", milestone.Number, "error", rerr)
	}
	return &CreateAdoptResult{Issue: issue, Adopted: true}, nil
}

// startOrWake is the tail both adoption routes end in: one run per milestone,
// woken if it is parked, started if there is none. It exists so neither route
// can drift from the other on the rule that matters most — never two agents on
// one branch.
//
// A RUNNING run re-reads its milestone at the next cycle boundary, so it needs
// nothing from us. A WAITING one is parked and re-derives only when told to —
// and the agent-work label adoption just wrote comes back as a suppressed echo,
// so the webhook path will not tell it. That is why waking is this path's job
// and not the delivery's.
func (e *Events) startOrWake(ctx context.Context, orgID, projectID string, milestone MilestoneRef) error {
	live, err := e.p.Runs.LiveRunForMilestone(ctx, orgID, projectID, milestone.Number)
	if err != nil {
		return err
	}
	if live != nil {
		slog.DebugContext(ctx, "eventcore: adoption into a milestone with a live run",
			"milestone", milestone.Number, "run", live.ID)
		return e.wakeIfWorkable(ctx, orgID, projectID, milestone.Number)
	}
	return e.startRun(ctx, orgID, projectID, milestone)
}

// appendMissingLabels adds each label the slice does not already carry, matching
// GitHub's case-insensitive label identity so a caller's hand-typed `AEP` is not
// duplicated as a second population.
func appendMissingLabels(labels []string, add ...string) []string {
	for _, label := range add {
		if !delivery.HasLabel(labels, label) {
			labels = append(labels, label)
		}
	}
	return labels
}

// adoptableMilestone is the version a bare issue belongs to: the deployed one
// first, then a spec build still in flight.
//
// The in-flight fallback is what makes an incident filed DURING a project's
// first build adoptable. That is not an edge case — it is the common one: the
// SRE/RCA agent fires on an alert raised by the very deployment the build is
// performing, so its handoff routinely lands minutes before the run that caused
// it reaches `succeeded`. Refusing there dropped the handoff permanently, since
// nothing retries it.
//
// Attaching to the in-flight run is also the same shape the platform already
// uses for a red build inside a run: the fix issue joins that run's milestone
// and the run works it in a later cycle.
func (e *Events) adoptableMilestone(ctx context.Context, orgID, projectID string) (*MilestoneRef, error) {
	deployed, err := e.p.Runs.DeployedMilestoneRun(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if deployed != nil {
		return &MilestoneRef{Number: deployed.MilestoneNumber, Title: deployed.MilestoneTitle}, nil
	}

	live, err := e.p.Runs.LiveRunsForProject(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	for i := range live {
		if live[i].Origin == delivery.RunOriginSpecBuild {
			slog.InfoContext(ctx, "eventcore: no deployed version — adopting into the spec build in flight",
				"project", projectID, "milestone", live[i].MilestoneNumber, "run", live[i].ID)
			return &MilestoneRef{Number: live[i].MilestoneNumber, Title: live[i].MilestoneTitle}, nil
		}
	}
	return nil, delivery.ErrNoAdoptableMilestone
}

// startRun asks the supervisor for an incident run over a milestone. Every run
// this package starts BY DETECTION is an incident adoption — the spec-build
// origin belongs to the plan path alone, where the version mutex lives, and the
// revalidate origin is only ever asked for by a human (Revalidate below).
func (e *Events) startRun(ctx context.Context, orgID, projectID string, milestone MilestoneRef) error {
	if e.p.Starter == nil {
		slog.DebugContext(ctx, "eventcore: no run starter wired — nothing to start",
			"project", projectID, "milestone", milestone.Number)
		return nil
	}
	err := e.p.Starter.StartRun(ctx, delivery.StartRunRequest{
		OrgID:           orgID,
		ProjectID:       projectID,
		MilestoneNumber: milestone.Number,
		MilestoneTitle:  milestone.Title,
		Origin:          delivery.RunOriginIncidentAdoption,
	})
	if errors.Is(err, delivery.ErrRunNotStarted) {
		// A degraded boot. This package re-offers on a timer — the reconcile
		// sweep runs every pass — so "not started yet" is nothing to report. The
		// callers that have no timer are the ones the sentinel exists for.
		slog.DebugContext(ctx, "eventcore: platform not ready to start a run — the sweep will re-offer",
			"project", projectID, "milestone", milestone.Number)
		return nil
	}
	return err
}

// Revalidate asks a version's acceptance criteria again, against the system
// already deployed.
//
// It is AdoptIssue's sibling and deliberately so: both hand a milestone to the
// run loop, both refuse to start a second run on one milestone, and both are
// reached from a human's request rather than from a delivery. The difference is
// what the run does first — adoption files work and the loop picks it up, while
// this files nothing and the loop enters at validation, because the milestone's
// working set is already empty.
//
// The three guards all run BEFORE the supervisor is asked, and the order is the
// cheap-and-certain first:
//
//  1. A live run on the milestone. This one ANSWERS the caller; it does not make
//     the invariant true. Two concurrent requests can both pass it, so the rule
//     itself lives in the database — a partial unique index admitting one
//     non-terminal run per milestone, which the insert's ON CONFLICT DO NOTHING
//     catches. Without that index the loser's row was admitted with no workflow
//     behind it (Temporal answers AlreadyStarted on the reused id) and, being
//     non-terminal, refused every later revalidation of that version forever.
//  2. Open work in the milestone.
//  3. An acceptance oracle to validate against.
//
// attempts and ceiling ride through untouched; zero on either means the
// platform default, resolved at the run row and again in the workflow.
func (e *Events) Revalidate(ctx context.Context, orgID, projectID string, milestone MilestoneRef, attempts, ceiling int) (runID string, err error) {
	// Criteria is required, not optional. Without it the oracle guard is skipped,
	// and a version with no criteria would run a revalidation that can only
	// conclude `skipped` — overwriting a real verdict, since the newest run owns
	// the version's answer. A misconfigured boot must refuse, not silently widen
	// what a revalidation may do.
	if e.p.Runs == nil || e.p.Issues == nil || e.p.Starter == nil || e.p.Criteria == nil {
		return "", fmt.Errorf("eventcore: revalidate not configured")
	}
	live, err := e.p.Runs.LiveRunForMilestone(ctx, orgID, projectID, milestone.Number)
	if err != nil {
		return "", err
	}
	if live != nil {
		return "", delivery.ErrRunAlreadyLive
	}
	counts, err := e.p.Issues.MilestoneIssueCounts(ctx, orgID, projectID, milestone.Number)
	if err != nil {
		return "", err
	}
	// The WORKING SET, not every open issue: a stray gate or the version's own
	// validation issue must not read as unfinished work, and neither is something
	// a coding cycle would pick up.
	if counts != nil && counts.OpenNonGateWork() > 0 {
		return "", delivery.ErrMilestoneHasOpenWork
	}
	hasCriteria, cerr := e.p.Criteria.HasValidationCriteria(ctx, orgID, projectID)
	if cerr != nil {
		return "", cerr
	}
	if !hasCriteria {
		return "", delivery.ErrNoAcceptanceCriteria
	}

	slog.InfoContext(ctx, "eventcore: revalidating a deployed version",
		"project", projectID, "milestone", milestone.Number, "version", milestone.Title,
		"validationAttempts", attempts, "cycleCeiling", ceiling)
	if serr := e.p.Starter.StartRun(ctx, delivery.StartRunRequest{
		OrgID:              orgID,
		ProjectID:          projectID,
		MilestoneNumber:    milestone.Number,
		MilestoneTitle:     milestone.Title,
		Origin:             delivery.RunOriginRevalidate,
		ValidationAttempts: attempts,
		CycleCeiling:       ceiling,
	}); serr != nil {
		return "", serr
	}
	// The row the supervisor just admitted. Read back rather than returned by
	// StartRun, which is shared with the detection paths and has no caller waiting
	// on an id — a revalidation's caller does, since the run's progress stream is
	// keyed by it.
	//
	// Its ABSENCE is the more important answer. StartRun reports success for
	// several states in which nothing was actually started — no agent dispatcher
	// wired, the workflow engine unreachable, the admission losing a race — because
	// its other callers re-offer on a timer and a degraded boot must not fail them.
	// A human waiting on a verdict has no such loop, so an empty read here is
	// reported rather than dressed up as a 202 over a run that does not exist.
	started, err := e.p.Runs.LiveRunForMilestone(ctx, orgID, projectID, milestone.Number)
	if err != nil {
		return "", err
	}
	if started == nil {
		return "", delivery.ErrRunNotStarted
	}
	return started.ID, nil
}
