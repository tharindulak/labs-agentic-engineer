# ADR-0022: The overview is a track of links, and it never sends

- **Status:** Accepted
- **Date:** 2026-08-29
- **Supersedes:** the **Card grammar** section of
  [the lexicon](../lexicon.md) (now *Track grammar*), and the rule from
  [#522](https://github.com/wso2/labs-agentic-engineer/issues/522) that a stage
  carries a CTA "when the flow stopped there".

## Context

The project overview answered three questions at once — what happened, what
exists, and what state things are in — and gave the largest column to the least
useful one.

- **The activity feed took half the page above the fold** to print "updated the
  spec" six times. Nothing in it was actionable, and every event in it was
  already visible on the page that owns the event.
- **Three stage cards read as three features.** They are one version moving
  through three gates, and nothing in the layout said so: no order, no
  direction, three separate borders.
- **The card grammar could not express the states that matter.** It assumed one
  card was "current". Amending a spec while the platform builds what you last
  published lights two stages at once, and a grammar that has to pick will pick
  wrong.
- **A stage card with a CTA re-opens a closed wound.** #562 removed three
  self-renaming buttons from the spec card for a reason recorded in
  `pipeline.ts`: *"a control that renames itself while you read it cannot be
  learned."* Any rule that puts a verb back on the overview reintroduces it.

## Decisions

1. **Spec → Build → Deploy is one track, not three cards.** One bar, three legs,
   a step numeral per leg and a chevron in the seam. Order and direction are
   carried by the numeral and the chevron alone — an earlier pass ran a
   connecting thread through the bar and it read as a progress meter the legs
   were already carrying.

   The seam **breaks the divider rather than decorating it**: the rule runs
   down, stops, the chevron stands in a knockout, the rule resumes. A small
   arrowhead painted mid-way along an unbroken full-height rule was tried first
   and read as an ornament stuck to the rule — the rule dominated and nothing
   looked connected.

2. **Every leg is a link, and the track has no buttons.** It navigates and
   summarises; it never sends. Publishing is a decision made after reading a
   diff, on the page that can show the diff — and the spec view already offers
   *generate designs* and *start building* where the context to choose them
   lives. *This is the limb that supersedes #522's CTA rule:* that rule was
   written for a card nobody could click, and a button inside a link is a broken
   target.

3. **Lit means unsettled, and the colour says who holds it.** Accent with a
   pulse is the platform working; amber and still is the platform waiting on the
   user. A settled leg is quiet. **More than one leg may be lit** — the
   single-current-stage assumption is retired.

4. **One summary line, present only when it relates two legs.** It is the only
   place that can say "building v1 while you draft v2", which no per-leg line
   can. A summary that paraphrases the leg above it is the duplication the chip
   was moved out of the page header to avoid, so most states have none.

5. **Validation rides the deploy leg.** It only runs once components are up; a
   fourth gate would be empty in most states, and empty gates teach readers to
   ignore the bar. A red verdict fails the leg and keeps its version chip —
   that version really is what is running in dev.

6. **The architecture diagram comes to the overview, and it is the same
   diagram.** `CellDiagramView` over the committed `specs/design/design.cell`,
   sharing the spec workspace's `layoutKey` so a layout arranged in one place is
   the layout seen in the other. It does **not** share the collab room: on a
   summary page a diagram that redraws mid-scroll while a design turn streams is
   a distraction, so this is a one-shot committed read. Per
   [ADR-0008](./ADR-0008-design-views-derived-client-side.md) this needs no new
   endpoint and no contract change.

7. **The activity feed is deleted, not relocated.** Spec edits are visible in the
   spec conversation, builds in the ledger (ADR-0021), deploys on the
   deployments board. The whole `features/activity` module goes with it — the
   SSE stream, its hooks, its mock handler. The backend endpoint is untouched;
   a future activity surface would want its own shape anyway.

8. **The project's status chip lives in the toolbar, not beside a page title.**
   It was a soft chip repeated on Overview, Deployments and Issues: three copies
   of one fact, each scrolling away with its page and each absent from the pages
   that never adopted it. It belongs with the project's identity, and that lives
   in the switcher. The chip's leading mark is a spinner only for states the
   platform will leave on its own — Building, Deploying, Validating — and a
   still dot otherwise, so a settled FAILURE never animates.

9. **A project with nothing in it gets the same body as any other**, each panel
   showing its own empty state. The first pass swapped the whole body for an
   explainer of the three stages, on the theory that three panels each saying
   "nothing here yet" is worse than one page that teaches. It is not. Every
   panel's empty state already names what belongs there and when it turns up
   (the PRD's rule: *empty states teach what, never narrate the how*), so the
   explainer was a fourth surface teaching the same thing in worse words — and
   it hid the shape of the page from the one reader who has never seen it.

   The no-prompt rule survives it: nothing on this page asks the user to start
   anything. The kickoff has already fired server-side (#562), so the agent is
   writing while the page renders, and on a project whose kickoff died the way
   to restart lives in the spec view where #562 put it.

10. **A leg may carry a call to action, and it is still not a button.** The one
    state that earns it is the agent's unanswered questions: the chat panel's
    pointer and the spec leg both navigate to the spec view, so the leg IS the
    control and only had to say so. Same wording in both places. A real
    `<button>` nested in the leg's anchor stays forbidden — see decision 2.

11. **The overview's diagram is fitted for an embed.** The renderer reserves
    112px top and bottom for floating chrome (zoom controls, canvas
    notification) that this panel hides — 224px of a 340px card. A `compact`
    flag trades that reservation for the diagram, and "Open in spec" deep-links
    to the Architecture view (`?view=architecture`) rather than the workspace's
    default file, since the link is offered because a diagram is drawn.

## Consequences

- The overview offers **no actions at all**. A user who lands on a failed build
  clicks through to Builds to act — one more step than a Retry button, and the
  price of a page whose controls never move or rename.
- `pipeline.ts` keeps only the validation vocabulary. The three stage-view
  builders moved to `track.ts`, which owns the track's lines, because the
  grammar they were written for no longer exists.
- The mock layer gains an `aep:mock:track` override beside `aep:mock:validation`
  for the spec/build/deploy combinations the scenario ladder cannot express —
  each of its rungs has the three stages agreeing with each other.
- **Not superseded:** the chip relocation and the repo-failure alert from
  [#563](https://github.com/wso2/labs-agentic-engineer/issues/563) are
  independent of the track and remain to be built as specified there.
