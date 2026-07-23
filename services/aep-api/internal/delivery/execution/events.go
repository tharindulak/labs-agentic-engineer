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

package execution

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/delivery"
)

// RegisterFunc is the webhook-router registration seam (the same closure shape
// app.go passes so this package imports nothing from feature/webhook).
type RegisterFunc func(event, action string, h func(ctx context.Context, event, action string, payload []byte) error)

// Events holds the pull_request webhook handlers — the platform-owned half of
// webhook handling (§9.2). PR-opened ends the coding Execution; PR-merged spawns
// a build Execution through the funnel's registered executor; PR-closed-unmerged
// records the coding attempt as rejected. The issues.* handlers are the Task
// feature's job (the §1 split is a package boundary).
//
// Echo suppression is deliberately NOT applied here: it is scoped to issues.*
// (where every platform label/comment/repair write fires an issues.* echo, §9.2)
// because the platform authors no pull requests. In App mode the coding-agent
// runner opens the PR as <slug>[bot] — the SAME login as the platform identity —
// so suppressing self-sender PR deliveries would drop the runner's own
// pull_request.opened and strand the coding Execution in_progress forever (its
// admission mutex held, its retry blocked). The PR is a human/runner gate, not a
// platform projection, so its deliveries are always acted on.
type Events struct {
	store    ExecutionStore
	funnel   *Funnel
	registry *Registry
	prs      PRReader // for the sweep's PR-state reconciliation (may be nil)
	// signaler feeds PR events to a waiting devflow TaskFlow workflow. Nil-safe:
	// a nil signaler (old-console flow, or Temporal disabled) is a no-op, so the
	// webhook handlers behave exactly as before when no workflow is driving.
	signaler *delivery.Signaler
	// notifier wakes any attached task-log SSE stream so the console sees a PR
	// transition (coding done / merged / rejected) instantly instead of on the
	// stream's slow re-derive tick. Nil-safe.
	notifier *delivery.TaskStreamHub
	// design maps changed files to components for the path-based build fan-out
	// (a merged PR rebuilds every component whose appPath it touched, not just
	// the Task's bound component). Nil-safe: unset falls back to building only
	// the Task's component (the pre-fan-out behavior).
	design DesignReader
	// autoMerge, when true, squash-merges a coding-agent PR the moment it opens
	// (linking a Task), removing the human review gate. DISABLED by default: this
	// auto-deploys unreviewed agent-authored code (the coding-agent's PRs are not
	// guaranteed correct), so a deployment must explicitly opt in via config.
	// repos resolves the delivered repo full name to org/project; merger does the
	// squash-merge. All three must be set for auto-merge to fire.
	autoMerge bool
	repos     RepoLookup
	merger    PRMerger
}

// NewEvents wires the pull_request handlers. prs may be nil (then the sweep
// healer no-ops).
func NewEvents(store ExecutionStore, funnel *Funnel, registry *Registry, prs PRReader) *Events {
	return &Events{store: store, funnel: funnel, registry: registry, prs: prs}
}

// WithWorkflowSignaler wires the devflow signaler so PR events reach a waiting
// TaskFlow workflow. Optional — unset leaves the old behavior unchanged.
func (e *Events) WithWorkflowSignaler(s *delivery.Signaler) *Events {
	e.signaler = s
	return e
}

// WithTaskNotifier wires the task-log stream hub so PR transitions wake attached
// console streams instantly. Optional — nil-safe.
func (e *Events) WithTaskNotifier(h *delivery.TaskStreamHub) *Events {
	e.notifier = h
	return e
}

// WithDesignReader wires the design reader used by the path-based build fan-out
// to map a merged PR's changed files onto components. Optional — unset leaves
// the single-component build behavior unchanged.
func (e *Events) WithDesignReader(d DesignReader) *Events {
	e.design = d
	return e
}

// WithAutoMerge enables (flag-gated) auto-merge of coding-agent PRs on open.
// enabled must be true AND both repos+merger set for it to fire. Default is
// DISABLED — auto-merge deploys unreviewed agent-authored code, so a deployment
// opts in explicitly (secure default). Optional — unset leaves the PR as the
// human review gate.
func (e *Events) WithAutoMerge(enabled bool, repos RepoLookup, merger PRMerger) *Events {
	e.autoMerge = enabled
	e.repos = repos
	e.merger = merger
	return e
}

// maybeAutoMerge squash-merges a just-opened coding-agent PR when auto-merge is
// enabled. Best-effort and fail-open: a resolution or merge failure is logged,
// never returned (it must not fail webhook processing) and the PR is simply left
// OPEN for a human — the safe fallback. This is a one-shot attempt on PR-open:
// it is NOT retried (the coding Execution is terminal by this point, so a later
// edited/ready_for_review delivery returns before reaching here), so it targets
// deployments whose repos have no required checks blocking an immediate squash.
// GitHub answers 405 while checks are pending/unmergeable; MergePullRequest
// reconciles an already-merged PR to success, so a benign not-yet-mergeable
// error just leaves the PR open for review.
func (e *Events) maybeAutoMerge(ctx context.Context, repoFullName string, prNumber int) {
	if !e.autoMerge || e.merger == nil || e.repos == nil || prNumber == 0 {
		return
	}
	orgID, projectID, err := e.repos.ByFullName(ctx, repoFullName)
	if err != nil {
		slog.WarnContext(ctx, "auto-merge: resolve repo failed", "repo", repoFullName, "pr", prNumber, "error", err)
		return
	}
	if err := e.merger.MergePullRequest(ctx, orgID, projectID, prNumber); err != nil {
		slog.WarnContext(ctx, "auto-merge: merge failed (PR left open for review/retry)", "repo", repoFullName, "pr", prNumber, "error", err)
		return
	}
	slog.InfoContext(ctx, "auto-merged coding-agent PR", "repo", repoFullName, "pr", prNumber)
}

// RegisterHandlers installs the pull_request handlers on the webhook router.
func (e *Events) RegisterHandlers(register RegisterFunc) {
	register("pull_request", "opened", e.PullRequestOpened)
	register("pull_request", "edited", e.PullRequestOpened)
	register("pull_request", "ready_for_review", e.PullRequestOpened)
	register("pull_request", "closed", e.PullRequestClosed)
	register("pull_request", "reopened", e.noop)
}

// closesIssueRefRE matches a "Closes #N" (and fixes/resolves variants) in a PR
// body — the same convention the coding agent writes so the platform can link
// the PR back to its Task. Same-repo only.
var closesIssueRefRE = regexp.MustCompile(`(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)\b`)

type pullRequestPayload struct {
	Action      string `json:"action"`
	PullRequest struct {
		Number         int    `json:"number"`
		Merged         bool   `json:"merged"`
		Draft          bool   `json:"draft"`
		State          string `json:"state"`
		Body           string `json:"body"`
		MergeCommitSHA string `json:"merge_commit_sha"`
		Head           struct {
			Ref string `json:"ref"`
		} `json:"head"`
	} `json:"pull_request"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	Sender struct {
		Login string `json:"login"`
	} `json:"sender"`
}

func parseClosesIssueRef(body string) int {
	m := closesIssueRefRE.FindStringSubmatch(body)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

func (e *Events) noop(context.Context, string, string, []byte) error { return nil }

// PullRequestOpened ends the coding Execution when a non-draft PR links a Task
// via "Closes #N" (§7: the coding Execution ends at PR-opened). Fires on
// opened/edited/ready_for_review; Finish is guarded so repeats are no-ops.
func (e *Events) PullRequestOpened(ctx context.Context, _, _ string, payload []byte) error {
	var p pullRequestPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil // malformed delivery — swallow (matches router no-op policy)
	}
	if p.PullRequest.Draft {
		return nil
	}
	issueNumber := parseClosesIssueRef(p.PullRequest.Body)
	if issueNumber == 0 || p.Repository.FullName == "" {
		return nil
	}
	execs, err := e.store.LatestPerKind(ctx, p.Repository.FullName, issueNumber)
	if err != nil {
		return err
	}
	coding := execs[string(taskmeta.KindCoding)]
	if coding == nil || !taskmeta.ExecutionStatus(coding.Status).IsActive() {
		return nil // no active coding attempt to end (already ended, or none)
	}
	// Stamp the PR number so the sweep can GET the live PR later (heals a missed
	// close/merge webhook — §5).
	if _, err := e.store.Finish(ctx, coding.ID, string(taskmeta.ExecSucceeded), reasonPROpenPrefix+strconv.Itoa(p.PullRequest.Number)); err != nil {
		return err
	}
	// The coding attempt is done (PR made) — tell any waiting TaskFlow workflow.
	e.signaler.SignalTask(ctx, p.Repository.FullName, issueNumber, delivery.SigPROpened, delivery.PRSignal{
		Repo:     p.Repository.FullName,
		Issue:    issueNumber,
		PRNumber: p.PullRequest.Number,
		HeadSHA:  p.PullRequest.MergeCommitSHA,
	})
	e.notifier.Notify(p.Repository.FullName, issueNumber)
	// Flag-gated auto-merge (no-op unless explicitly enabled via config). The
	// guards above scope it tightly: a non-draft PR whose body "Closes #N" a Task
	// with a currently-ACTIVE coding attempt — i.e. the coding agent's own PR in
	// the normal flow. There is no PR-author check (in App mode the runner's PR
	// login equals the platform identity; in PAT mode it is a real user), so the
	// residual, narrow risk is a human racing the agent with a Closes-ref PR on
	// that same active Task in a deployment that opted into auto-merge.
	e.maybeAutoMerge(ctx, p.Repository.FullName, p.PullRequest.Number)
	return nil
}

// PullRequestClosed spawns a build Execution on merge and records rejection on
// close-unmerged (§4/§7). Merging a PR is the human gate — the build proceeds
// regardless of issue state.
func (e *Events) PullRequestClosed(ctx context.Context, _, _ string, payload []byte) error {
	var p pullRequestPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil
	}
	issueNumber := parseClosesIssueRef(p.PullRequest.Body)
	if issueNumber == 0 || p.Repository.FullName == "" {
		return nil
	}

	if !p.PullRequest.Merged {
		// PR closed without merging → record the coding attempt as rejected by
		// appending a terminal coding row (never mutate a terminal row). The
		// derived status flips to rejected via prState (§4).
		e.signaler.SignalTask(ctx, p.Repository.FullName, issueNumber, delivery.SigPRRejected, delivery.PRSignal{
			Repo:     p.Repository.FullName,
			Issue:    issueNumber,
			PRNumber: p.PullRequest.Number,
		})
		e.notifier.Notify(p.Repository.FullName, issueNumber)
		return e.recordRejection(ctx, p.Repository.FullName, issueNumber)
	}

	// Merged → spawn a build Execution and dispatch it through the registered
	// executor (§7). Builds do not pass the deps gate — a merged PR proceeds.
	// Tell any waiting TaskFlow workflow the PR merged (it then awaits the build).
	e.signaler.SignalTask(ctx, p.Repository.FullName, issueNumber, delivery.SigPRMerged, delivery.PRSignal{
		Repo:     p.Repository.FullName,
		Issue:    issueNumber,
		PRNumber: p.PullRequest.Number,
		MergeSHA: p.PullRequest.MergeCommitSHA,
	})
	e.notifier.Notify(p.Repository.FullName, issueNumber)
	return e.spawnBuild(ctx, p.Repository.FullName, issueNumber, p.PullRequest.Number, p.PullRequest.MergeCommitSHA)
}

// spawnBuild admits + dispatches build Executions for a merged Task. Shared by
// the PR-closed(merged) webhook and the sweep's PR-state healer.
//
// Path-based fan-out: a merged PR rebuilds EVERY component whose source it
// touched — not just the Task's bound component — because the coding agent
// often lands a cross-component fix in one PR (e.g. an incident that alerts on
// service1 whose fix is in service2). The Task's own component is always built;
// extra components are discovered by matching the PR's changed files against
// each design component's appPath. Degrades to the single Task component when
// the PR number, PR-file reader, or design paths are unavailable.
func (e *Events) spawnBuild(ctx context.Context, repoFullName string, issueNumber, prNumber int, mergeSHA string) error {
	facts, ok, err := e.funnel.TaskFactsFor(ctx, repoFullName, issueNumber)
	if err != nil {
		return err
	}
	if !ok {
		slog.WarnContext(ctx, "pr merged for unknown Task", "repo", repoFullName, "issue", issueNumber)
		return nil
	}
	if facts.Class == taskmeta.ClassValidation {
		// A merged validation PR spawns no build — a validation Task is project-
		// scoped (no component to build) and rests at `merged` once its PR merges
		// (validation-phase). Deriving stays at merged with no build Execution.
		return nil
	}

	components := e.buildTargets(ctx, facts, prNumber)

	// Dedupe on MERGE IDENTITY (merge SHA) per COMPONENT: skip a component that
	// already has a build row for THIS merge (a GitHub re-delivery). The existing
	// rows are loaded ONCE here — not per component — so fan-out over N components
	// stays a single ListByIssue read instead of an N+1 scan. Distinct components
	// under one merge each admit their own row; a new merge carries a new SHA so
	// it always admits fresh (§7 retry = new row). Empty mergeSHA skips dedupe.
	builtForMerge := map[string]bool{}
	if mergeSHA != "" {
		rows, derr := e.store.ListByIssue(ctx, repoFullName, issueNumber)
		if derr != nil {
			return derr
		}
		for i := range rows {
			if rows[i].Kind == string(taskmeta.KindBuild) && rows[i].CommitSHA == mergeSHA {
				builtForMerge[strings.ToLower(rows[i].Component)] = true
			}
		}
	}

	var firstErr error
	for i, comp := range components {
		if builtForMerge[strings.ToLower(comp)] {
			continue // re-delivery of this same merge for this component
		}
		cf := facts
		cf.Component = comp
		if berr := e.admitAndDispatchBuild(ctx, cf, mergeSHA); berr != nil {
			// The Task's own component (i==0) is the primary: propagate its error
			// so the webhook retries. An extra component's failure is logged but
			// must not block the other builds or fail the whole delivery.
			if i == 0 {
				firstErr = berr
			} else {
				slog.WarnContext(ctx, "path-based build failed for extra component", "component", comp, "error", berr)
			}
		}
	}
	return firstErr
}

// buildTargets is the set of components to build for a merged PR: always the
// Task's own component (first — its dispatch error is the one propagated), plus
// any design component whose appPath prefixes a file the PR changed. Degrades to
// just facts.Component when the PR number, PR-file reader, or design reader is
// unavailable, or on any lookup error.
func (e *Events) buildTargets(ctx context.Context, facts delivery.TaskFacts, prNumber int) []string {
	targets := []string{facts.Component}
	seen := map[string]bool{strings.ToLower(facts.Component): true}

	if prNumber == 0 || e.prs == nil || e.design == nil {
		return targets
	}
	files, err := e.prs.ListPullRequestFiles(ctx, facts.OrgID, facts.ProjectID, prNumber)
	if err != nil {
		slog.WarnContext(ctx, "path-based build: list PR files failed, building only the Task component", "pr", prNumber, "error", err)
		return targets
	}
	paths, err := e.design.ComponentPaths(ctx, facts.OrgID, facts.ProjectID)
	if err != nil {
		slog.WarnContext(ctx, "path-based build: read component paths failed, building only the Task component", "error", err)
		return targets
	}
	for name, appPath := range paths {
		if seen[strings.ToLower(name)] {
			continue
		}
		if changedUnder(files, appPath) {
			targets = append(targets, name)
			seen[strings.ToLower(name)] = true
		}
	}
	return targets
}

// changedUnder reports whether any changed file lives under appPath (a
// component's source directory relative to the repo root). An empty appPath
// means the component builds from the repo root, so any change matches.
func changedUnder(files []string, appPath string) bool {
	if appPath == "" {
		return len(files) > 0
	}
	prefix := appPath + "/"
	for _, f := range files {
		if f == appPath || strings.HasPrefix(f, prefix) {
			return true
		}
	}
	return false
}

// admitAndDispatchBuild admits one build Execution for facts.Component pinned to
// mergeSHA and dispatches it through the class executor. Extracted so the
// path-based fan-out can call it once per target component.
func (e *Events) admitAndDispatchBuild(ctx context.Context, facts delivery.TaskFacts, mergeSHA string) error {
	row := &delivery.Execution{
		OrgID:       facts.OrgID,
		ProjectID:   facts.ProjectID,
		Repo:        facts.Repo,
		IssueNumber: facts.IssueNumber,
		Kind:        string(taskmeta.KindBuild),
		Status:      string(taskmeta.ExecQueued),
		DesignTag:   facts.DesignTag,
		Component:   facts.Component,
		// Pin the build to the merge commit so a git-auth retry can re-trigger the
		// same build after re-minting the clone credential (§7).
		CommitSHA: mergeSHA,
	}
	admitted, adRow, err := e.store.TryAdmit(ctx, row)
	if err != nil {
		return err
	}
	if !admitted {
		return nil // a build for this (component, merge) is already in flight
	}
	executor, ok := e.registry.Lookup(facts.Class)
	if !ok {
		slog.WarnContext(ctx, "no executor for merged Task's class", "class", facts.Class)
		_, _ = e.store.Finish(ctx, adRow.ID, string(taskmeta.ExecCanceled), reasonNoExecutor+" "+string(facts.Class))
		return nil
	}
	if err := executor.Run(ctx, delivery.DispatchRequest{Execution: adRow, Task: facts, MergeSHA: mergeSHA}); err != nil {
		_, _ = e.store.Finish(ctx, adRow.ID, string(taskmeta.ExecFailed), err.Error())
		return err
	}
	return nil
}

// ReconcileTaskPR is the sweep's PR-state healer (§5): for one Task whose latest
// coding Execution claims an open PR (and no build yet), it GETs the live PR
// state and applies the handler a missed webhook would have — merged spawns the
// build, closed-unmerged records the rejection. A no-divergence PR is a no-op.
// The Task facts and its latest-per-kind executions are passed in (the sweep
// already listed the issues and batch-loaded the rows for the whole repo).
func (e *Events) ReconcileTaskPR(ctx context.Context, orgID, projectID, repoFullName string, issueNumber int, execs map[string]*delivery.Execution) error {
	if e.prs == nil {
		return nil
	}
	coding := execs[string(taskmeta.KindCoding)]
	prNum := openPRNumber(coding)
	if prNum == 0 {
		return nil // latest coding is not claiming an open PR — nothing to heal
	}
	// Already healed for THIS coding attempt's merge? A build row NEWER than the
	// coding row claiming this PR means the current merge is built — nothing to do.
	// An OLDER build (from a previous coding attempt) must NOT block healing this
	// new PR (the round-2 defect: a second merged PR was skipped because an old
	// terminal build existed). spawnBuild's merge-SHA dedupe is the backstop.
	if b := execs[string(taskmeta.KindBuild)]; b != nil && coding != nil && !b.CreatedAt.Before(coding.CreatedAt) {
		return nil
	}
	pr, err := e.prs.GetPullRequestState(ctx, orgID, projectID, prNum)
	if err != nil || pr == nil {
		return err // transient — next sweep retries
	}
	switch {
	case pr.Merged:
		return e.spawnBuild(ctx, repoFullName, issueNumber, prNum, pr.MergeCommitSHA)
	case pr.State == "closed":
		return e.recordRejection(ctx, repoFullName, issueNumber)
	}
	return nil // PR still open — no divergence
}

// recordRejection appends a terminal coding row tagged
// taskmeta.ReasonPRClosedUnmerged so the derived status becomes rejected. If a
// coding Execution is still active (rare — PR closed while the agent was
// mid-run), it is Finished failed instead.
func (e *Events) recordRejection(ctx context.Context, repo string, issueNumber int) error {
	execs, err := e.store.LatestPerKind(ctx, repo, issueNumber)
	if err != nil {
		return err
	}
	if coding := execs[string(taskmeta.KindCoding)]; coding != nil && taskmeta.ExecutionStatus(coding.Status).IsActive() {
		_, ferr := e.store.Finish(ctx, coding.ID, string(taskmeta.ExecFailed), taskmeta.ReasonPRClosedUnmerged)
		return ferr
	}
	// No active coding row — the run already succeeded at PR-open. Look up the
	// org/project to append the rejection row.
	facts, ok, err := e.funnel.TaskFactsFor(ctx, repo, issueNumber)
	if err != nil || !ok {
		return err
	}
	row := &delivery.Execution{
		OrgID:       facts.OrgID,
		ProjectID:   facts.ProjectID,
		Repo:        facts.Repo,
		IssueNumber: facts.IssueNumber,
		Kind:        string(taskmeta.KindCoding),
		Status:      string(taskmeta.ExecQueued),
		DesignTag:   facts.DesignTag,
		Component:   facts.Component,
	}
	admitted, adRow, err := e.store.TryAdmit(ctx, row)
	if err != nil {
		return err
	}
	if !admitted {
		return nil
	}
	_, ferr := e.store.Finish(ctx, adRow.ID, string(taskmeta.ExecFailed), taskmeta.ReasonPRClosedUnmerged)
	return ferr
}
