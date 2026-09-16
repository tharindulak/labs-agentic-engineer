# ADR-0032: The bell rings for attention, not for every report

- **Status:** Accepted
- **Date:** 2026-09-16
- **Context:** ADR-0008 gave Alerts *two entry points, same content* — a
  top-nav bell and a left-nav section, both fed by every `RcaAgentReport` the
  SRE/RCA-agent handoff produces. In practice most reports need nobody: the
  handoff files an issue, a coding agent works it, the fix merges, and the
  badge counted all of it. A badge that is always lit says nothing, so it was
  read as decoration rather than as a summons. Meanwhile the project's
  **Issues** section was still the placeholder #173 shipped, so the one place
  where "this one needs you" is actually knowable had no surface at all.

## Decisions

1. **The bell carries issue-lifecycle attention events, not reports.** Exactly
   three states qualify, each one a question only a person can close:
   **unverified fix** (a coding-agent PR merged without `Confidence: high`;
   the platform reopened the issue), **no-change verdict** (the agent closed
   the issue `not_planned`, and the recurrence loop stops until a human
   reopens it), **escalated recurrence** (the same incident is on attempt 4 or
   later). The backend computes them — `IssueInfo.AttentionReason`, from the
   predicates `issue_recurrence.go` already owned — so the console classifies
   nothing. The `provision`-kind dispatch brake is deliberately not one of
   them: a person opened that issue on purpose.

2. **The two Alerts surfaces now have different scopes, on purpose.** The
   dedicated **Alerts** left-nav section is unchanged and still lists every
   RCA report with its stepper — the browsable record. The bell answers the
   narrower question *does anything need me right now*. This supersedes
   ADR-0008's "two entry points" for the bell only; the section, the
   read-only stance, and the non-goal narrowing ADR-0008 recorded all stand.

3. **Seen is keyed by issue *and* reason, and the key set is the last thing
   the user saw.** A timestamp watermark does not fit — these events are not a
   monotonic timeline, and an issue can clear one attention state and later
   re-enter the same one, which is news again. So `useAttentionUnread` stores
   `` `${project}:${number}:${reason}` `` keys in localStorage and, on open,
   **replaces** the set with the keys then on screen rather than adding to it:
   a union would grow forever and would keep a re-entered issue silent.
   Pruning happens on the user's own act of looking, never reactively on the
   item list, which goes empty on every refetch.

4. **One request per project, cached for the poll interval.** `list-issues` is
   project-scoped, so the bell fans out across the project list — a deliberate
   N+1 from the browser, not a new aggregate endpoint, and a known scaling
   limit to revisit. It is bounded to 50 projects and held to the bell's
   existing 60s cadence as *both* `refetchInterval` and `staleTime`; without
   the stale window every mount and window focus would refire the whole
   fan-out.

5. **An empty bell never stands in for a broken one.** The panel says so when
   the project list itself failed (*nothing was checked*) and, separately,
   when some projects' fetches failed (*showing what loaded*) — both above the
   list, because either can leave it empty.

## Consequences

- `useRecentAlerts`, `useAlertsUnread` and the bell's `BELL_LIMIT` /
  `BELL_POLL_MS` had no caller left once the bell was repointed, and are
  deleted; `useAlertsInfinite` and `useAlertReport` stay with the Alerts page.
- Any new "needs a human" event belongs on `AttentionReason` in the contract,
  not in a console-side rule — the bell renders reasons, it does not decide
  them.
- A feature that wants the bell to carry something other than an issue
  attention event (a failed run, an agent's question) must say so here or
  supersede this ADR; ADR-0031 records the failed-run case staying off it.
