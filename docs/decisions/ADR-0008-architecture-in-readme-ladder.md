# ADR-0008 — Architecture is documented as a README ladder, coupled to arch tests

## Context

The domain migration (git history through tag `domain-migration-pre-squash`) was
driven by a 1444-line plan, `docs/design/domain-oriented-architecture.md`, whose §19
was a P0→P9 phase ladder. Because the *current* architecture was described only inside
that plan, ~30 source files cited it by section number, and the seven domain READMEs
inherited its migration tense — "defer to P9", "not yet carved", "still in `models/`" —
describing a pre-P9 layout that no longer exists (`models/` and `repositories/` were
dissolved into the owning domains in P9). A plan is the wrong home for the current
architecture: it goes stale the moment it completes, yet it was what every reference
pointed at. `docs/design/api_target.md` had the same defect — it says of itself, "a
record of what was done, not a map of what is there now."

## Decision

The architecture is documented as a **README ladder** that flows high→low, each rung
coupled to the code that enforces it:

- **L0** `docs/architecture.md` — repo overview.
- **L1** `services/aep-api/README.md` — the **map hub**: the domain graph (one shared
  diagram legend), the conventions, the structural **vocabulary**, and the **platform
  invariants**, each invariant naming the test that enforces it.
- **L2** `internal/<domain>/README.md` — one per domain: Slices · Ports · Owns ·
  Invariants (only the domain-*specific* ones; general platform rules live at L1).
- **L3** `doc.go` + `internal/arch/*_test.go` — the executable truth.

Rules, not prose, hold authority: **if a README and its named test disagree, the test
wins.** Docs point at the enforcing test; they never restate its assertion.

Every doc describes the **current, shipped state — never a plan or a phase.** From that:

- The two migration-plan docs (`domain-oriented-architecture.md`, `api_target.md`) are
  removed from the tree — preserved in git history and tag `domain-migration-pre-squash`.
- The spent migration scaffolding (`internal/arch/migration_shim_test.go` and its
  `currentPhase` constant) is retired; its end-state is already locked by
  `TestFlatPackagesDeleted`, `TestAllDomainsLanded`, and `TestDomainsAreFeatureFree`.
- The convention is written into `services/AGENTS.md`.

## Considered options

- **Keep the design doc as the architecture source.** Rejected: a plan doc rots the
  moment its plan completes — it already had — and it is the wrong shape for "what is
  here now."
- **One big architecture README** (all domain detail inline; domain READMEs as stubs).
  Rejected: a wall of text is not a high→low flow, and it re-couples all seven domains
  into a single file.
- **Repeat the cross-cutting invariants in every domain README** (the status quo).
  Rejected: a platform-rule change becomes a seven-file edit and the copies drift.
- **Prose invariants with no test citation.** Rejected: uncoupled docs drift from the
  enforced architecture undetected — the exact rot this decision prevents.

## Consequences

- One entry point (the L1 hub) and one home for each platform rule; domain READMEs stay
  small and local to the domain a reader is working in.
- Docs are anchored to `internal/arch`: a structural rule cannot silently rot, because CI
  runs the test the doc names, and a renamed test surfaces as a stale reference in one
  package.
- The repo currently has two ubiquitous-language files (`CONTEXT.md` and
  `docs/glossary.md`). This decision adds the aep-api product terms to `docs/glossary.md`
  (the glossary named by root `AGENTS.md`) and leaves consolidating the two as separate
  work.
