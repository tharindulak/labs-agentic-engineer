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
	// Labels is the issue's label set, when the caller has it. Adoption starts a
	// TASK run, so it routes on the KIND these carry and refuses an issue that
	// belongs to another species (delivery.AdoptableByATaskRun).
	//
	// Empty means "unclassified", which adopts — the console's dispatch button
	// hands over a bare issue a human has not labelled at all, and that is the
	// ordinary path rather than a missing check.
	Labels []string
}

// AdoptIssue hands an issue that ALREADY EXISTS to the coding agent: the `aep`
// arming label arriving by webhook, and any caller that adopts an issue by
// number directly (a label the platform stamps itself comes back as an echo and
// is dropped, so a direct caller cannot rely on the webhook).
//
// Its sibling AdoptOnCreate below is the other direction — the caller filing the
// issue asks for it in the same breath.
//
// The rules, in order:
//
//   - An issue that already has a milestone keeps it. The human put it there.
//
//   - A bare issue joins the milestone of the version it is an incident
//     against: the deployed one, or — when nothing has been deployed yet — the
//     spec build currently in flight. With neither, the caller gets
//     delivery.ErrNoAdoptableMilestone rather than a guess.
//
//     This second rule is also RE-HOMING, which is what a reopened incident
//     issue needs. Its milestone was assigned by adoption months ago, to a
//     version that is no longer deployed and whose milestone is settled — so
//     the recurrence path calls this with a bare target on purpose, and the
//     issue is resolved into the current adoptable milestone rather than left
//     in history. "The human put it there" is true of a milestone a human
//     chose; it was never true of one adoption itself assigned (ADR-0018).
//
//   - If a run is already live on that milestone, no second run starts —
//     that would put two agents on one branch. A run parked on that milestone is
//     woken by the same webhook delivery that carried the arming label, not by
//     this call (see wakePolicy).
//   - Otherwise an incident run starts over that milestone.
//
// Adoption does NOT stamp the arming label. The working set is read from the
// milestone, and arming IS the human's act of adoption — inventing a second,
// platform-authored path to the same state would make "who adopted this"
// unanswerable — and it is why the wake belongs to the webhook here: the write
// that brought us in was a human's, so its own delivery re-evaluates the
// predicate on the way out.
//
// Nor does it stamp a KIND. An armed issue carrying none reads as a bug to every
// working-set predicate (delivery.InDevWorkingSet), which is what a human
// handing over an unclassified issue means, and it is the same answer the host's
// counts give — the two must not disagree about one issue.
func (e *Events) AdoptIssue(ctx context.Context, orgID, projectID string, target AdoptTarget) error {
	if target.Number == 0 || e.p.Runs == nil {
		return nil
	}
	// Route on the kind BEFORE anything is written. An issue that belongs to
	// another species must not be pulled into a bug-fix run, and it must not be
	// moved into the deployed version's milestone on the way there either.
	if !delivery.AdoptableByATaskRun(target.Labels) {
		slog.DebugContext(ctx, "eventcore: not adopting — this issue is another run species' work",
			"issue", target.Number, "kind", delivery.KindOf(target.Labels))
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

	return e.startOrWake(ctx, orgID, projectID, milestone, leaveTheWakeToTheWebhook)
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
// spec build in flight, when nothing is deployed yet), and a milestone that
// already has a live run gets that run woken rather than a second one started.
//
// The arming label is the one rule this path does NOT share, and for the reason
// that makes AdoptIssue refuse to write it: arming is the act of adoption. Here
// the CALLER is the one adopting, in the same call that files the issue, so `aep`
// rides the create rather than being stamped onto somebody else's issue after
// the fact. It stamps no KIND, exactly as AdoptIssue does not — an armed issue
// carrying none reads as a bug.
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
	// The WRITER, not the read port: every issue this package files goes through
	// the domain's one issue-write surface, and adoption-at-creation is no
	// exception — it is a mint like any other, with a milestone and a label on it.
	if e.p.Writer == nil || e.p.Runs == nil {
		return nil, fmt.Errorf("adopt on create: no issue writer wired")
	}

	milestone, err := e.adoptableMilestone(ctx, orgID, projectID)
	if err != nil {
		if !errors.Is(err, delivery.ErrNoAdoptableMilestone) {
			// A read that failed for any other reason is a server fault, and the
			// caller may retry it. Filing first and failing after would leave a
			// duplicate behind on that retry for every caller without a dedupe key.
			return nil, err
		}
		issue, cerr := e.p.Writer.MintResult(ctx, orgID, projectID, ledgerSpec(req))
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

	spec := ledgerSpec(req)
	spec.Milestone = milestone.Number
	spec.Labels = appendMissingLabels(spec.Labels, delivery.LabelAgentWork)

	issue, err := e.p.Writer.MintResult(ctx, orgID, projectID, spec)
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

	if issue.Suppressed {
		// A coding agent already examined this exact signature and closed it as
		// needing no code change. Dispatching another one asks the same question
		// and pays another cycle for the same answer; the caller is told where
		// the decision lives so it can say so rather than look ignored.
		slog.InfoContext(ctx, "eventcore: create suppressed — this signature is already decided",
			"project", projectID, "issue", issue.Number)
		return &CreateAdoptResult{
			Issue: issue,
			Reason: fmt.Sprintf("a coding agent already decided issue #%d needs no code change; "+
				"reopen it to have this worked again", issue.Number),
		}, nil
	}

	if issue.Reopened {
		// A recurrence: the create side appended the new evidence and reopened a
		// CLOSED issue, so none of the create-time milestone and label work above
		// reached GitHub. Adoption has to happen the after-the-fact way, and it
		// is handed a BARE target deliberately — that is what re-homes the issue
		// out of the settled milestone it was fixed in and into the version
		// deployed now. AdoptIssue is reused rather than reimplemented so the
		// recurrence route cannot drift from adoption's rules; in particular it
		// ends in the same startOrWake, which is what keeps two agents off one
		// branch.
		//
		// The ARMING is this path's own, and it has to be: AdoptIssue refuses to
		// stamp `aep` because arming is the act of adoption and the write that
		// reaches it is a human's. Nothing human happened here — the platform
		// reopened this issue off a dedupe key — so if this path does not arm it,
		// nothing does, and the recurrence lands in the milestone as a ledger
		// entry no run will ever work. It is the same reasoning that puts `aep`
		// on the create call above: on THIS path the platform is the adopter.
		//
		// Stamped BEFORE the re-home and the wake, so the run that is woken can
		// already see the issue in its working set.
		if e.p.Issues != nil {
			if lerr := e.p.Issues.AddLabels(ctx, orgID, projectID, issue.Number,
				[]string{delivery.LabelAgentWork}); lerr != nil {
				slog.WarnContext(ctx, "eventcore: incident recurred but could not be re-armed",
					"project", projectID, "issue", issue.Number, "error", lerr)
				return &CreateAdoptResult{Issue: issue, Reason: lerr.Error()}, nil
			}
		}
		if aerr := e.AdoptIssue(ctx, orgID, projectID, AdoptTarget{Number: issue.Number}); aerr != nil {
			slog.WarnContext(ctx, "eventcore: incident recurred but could not be re-adopted",
				"project", projectID, "issue", issue.Number, "error", aerr)
			return &CreateAdoptResult{Issue: issue, Reason: aerr.Error()}, nil
		}
		slog.InfoContext(ctx, "eventcore: incident recurred — reopened issue re-homed and re-adopted",
			"project", projectID, "issue", issue.Number, "attempt", issue.Recurrence)
		return &CreateAdoptResult{Issue: issue, Adopted: true}, nil
	}

	// The issue is adopted from here on — it is in the milestone and carries the
	// agent-work label. A run that fails to start is therefore NOT an adoption
	// failure: the sweep finds a milestone with open work and no live run, and
	// starts one within its interval. Reporting a failure here would be wrong
	// twice over, since the issue is filed and the run is coming.
	if rerr := e.startOrWake(ctx, orgID, projectID, *milestone, wakeAParkedRun); rerr != nil {
		slog.WarnContext(ctx, "eventcore: adopted on create, but the run did not start — leaving it to the sweep",
			"project", projectID, "issue", issue.Number, "milestone", milestone.Number, "error", rerr)
	}
	return &CreateAdoptResult{Issue: issue, Adopted: true}, nil
}

// wakePolicy says who owns waking a run already parked on the milestone. It is
// spelled at the call sites because getting it wrong is invisible either way: a
// missing wake leaves a run asleep on work, and a duplicate one signals twice.
type wakePolicy bool

const (
	// wakeAParkedRun — this path is the only thing that knows work arrived. The
	// issue was written by the platform's own credential, so the delivery it
	// caused comes back as a suppressed echo and no webhook will do it.
	wakeAParkedRun wakePolicy = true
	// leaveTheWakeToTheWebhook — a HUMAN's write brought us here, so the same
	// issues delivery that carried it re-evaluates the predicate on its way out
	// (events.go). Waking here as well would signal the run twice.
	leaveTheWakeToTheWebhook wakePolicy = false
)

// startOrWake is the tail both adoption routes end in: one run per milestone,
// woken if it is parked, started if there is none. It exists so neither route
// can drift from the other on the rule that matters most — never two agents on
// one branch.
func (e *Events) startOrWake(
	ctx context.Context,
	orgID, projectID string,
	milestone MilestoneRef,
	wake wakePolicy,
) error {
	live, err := e.p.Runs.LiveRunForMilestone(ctx, orgID, projectID, milestone.Number)
	if err != nil {
		return err
	}
	if live != nil {
		// No second run, and what makes that safe is the run's next CYCLE
		// BOUNDARY: a dev or task run re-reads its milestone there and picks the
		// issue up. A WAITING run has no such boundary until something wakes it,
		// which is what the wake policy decides the owner of.
		//
		// A live VALIDATION run has no boundary at all — it polls no working set
		// — so an issue adopted while one is judging is picked up by the
		// reconcile sweep instead, once that run settles. Starting a second run
		// here would be worse than the wait: the per-milestone index refuses it,
		// and two agents on one branch is what the index exists to prevent.
		slog.DebugContext(ctx, "eventcore: adoption into a milestone with a live run",
			"milestone", milestone.Number, "run", live.ID, "kind", live.Kind)
		if wake == leaveTheWakeToTheWebhook {
			return nil
		}
		return e.wakeIfWorkable(ctx, orgID, projectID, milestone.Number)
	}
	return e.startRun(ctx, orgID, projectID, milestone)
}

// ledgerSpec is the caller's create request as a mint spec: the issue exactly as
// asked for, in no milestone and carrying no platform label. Adoption adds those
// two on top, which is the whole difference between a ledger entry and work.
func ledgerSpec(req sourcecontrol.CreateIssueRequest) delivery.IssueSpec {
	spec := delivery.IssueSpec{
		Title:     req.Title,
		Body:      req.Body,
		Labels:    req.Labels,
		DedupeKey: req.DedupeKey,
	}
	if req.Milestone != nil {
		spec.Milestone = *req.Milestone
	}
	return spec
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

// startRun asks the supervisor for a TASK run over a milestone: work the
// milestone's open defects. A dev run belongs to the plan path alone, where the
// version mutex lives.
func (e *Events) startRun(ctx context.Context, orgID, projectID string, milestone MilestoneRef) error {
	return e.start(ctx, projectID, delivery.StartRunRequest{
		OrgID:           orgID,
		ProjectID:       projectID,
		MilestoneNumber: milestone.Number,
		MilestoneTitle:  milestone.Title,
		Kind:            delivery.RunKindTask,
		Origin:          delivery.RunOriginIncidentAdoption,
	})
}

// startValidationRun asks the supervisor to JUDGE a version, because its
// validation task is open.
//
// The reconcile sweep is its caller, which makes this the platform's own trigger
// rather than a human's: a dev run settles having filed the task, and this is
// what turns that task into a run. The `revalidate` origin is honest either way —
// an origin is a label on the trigger, and what the run DOES is its kind.
//
// It carries no attempt allowance, so the run resolves the platform default. The
// per-version allowance is spent by the milestone's validation runs, counted from
// the ledger, so a sweep-started attempt cannot widen what a version is allowed.
func (e *Events) startValidationRun(ctx context.Context, orgID, projectID string, milestone MilestoneRef) error {
	return e.start(ctx, projectID, delivery.StartRunRequest{
		OrgID:           orgID,
		ProjectID:       projectID,
		MilestoneNumber: milestone.Number,
		MilestoneTitle:  milestone.Title,
		Kind:            delivery.RunKindValidation,
		Origin:          delivery.RunOriginRevalidate,
	})
}

// start is the shared ask, and the shared reading of a degraded boot.
func (e *Events) start(ctx context.Context, projectID string, req delivery.StartRunRequest) error {
	if e.p.Starter == nil {
		slog.DebugContext(ctx, "eventcore: no run starter wired — nothing to start",
			"project", projectID, "milestone", req.MilestoneNumber)
		return nil
	}
	err := e.p.Starter.StartRun(ctx, req)
	if errors.Is(err, delivery.ErrRunNotStarted) {
		// A degraded boot. This package re-offers on a timer — the reconcile
		// sweep runs every pass — so "not started yet" is nothing to report. The
		// callers that have no timer are the ones the sentinel exists for.
		slog.DebugContext(ctx, "eventcore: platform not ready to start a run — the sweep will re-offer",
			"project", projectID, "milestone", req.MilestoneNumber)
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
	// validation task must not read as unfinished work, and neither is something
	// a coding cycle would pick up.
	if counts != nil && counts.OpenDevWork() > 0 {
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
		Kind:               delivery.RunKindValidation,
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
