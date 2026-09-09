# SRE handoff — demo scenarios

Requirement sets for demonstrating the log-based loop end to end: an ERROR in a
running service becomes an alert, an RCA, a GitHub issue, and a coding-agent PR.

- **How to wire the loop**: [`sre-handoff-runbook.md`](./sre-handoff-runbook.md)
- **What the handoff decides, and how**: `services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md`
- **Why filing an issue dispatches the agent**: [`ADR-0017`](../decisions/ADR-0017-filing-an-issue-is-the-dispatch.md)

---

## The rule that makes or breaks a demo

**The logged failure has to be a defect *relative to the spec*, not something the
spec requires.**

The first demo spec written for this loop made the failure an acceptance
criterion — *"Service2 delays 8 seconds"* and *"Service1 gives up after 5
seconds"* — and the handoff declined it, correctly. Its stored rationale:

> the existing issues confirm this is the designed behavior of this demo system
> […] the timeout scenario is a validation criterion (REQ-004, REQ-005, AC-004-a,
> AC-005-a, AC-005-b) […] would give the coding agent nothing actionable to
> correct.

The decline was the right call twice over: there was no defect to fix, and a
coding agent that "fixed" the delay would have broken the version's own
acceptance criteria, so the platform's validation cycle would then have failed
the version it just built.

### The pattern that works

> **Spec the fault surface. Leave the handling unspecified.**

- The deliberate fault — a slow endpoint, a flaky endpoint, one that returns a
  requested status code — **is** an acceptance criterion. The coding agent must
  keep it, and it gives the filed issue's *"what must not change"* line something
  concrete to cite.
- The **handling** of that fault is absent from the spec, so the generated
  implementation omits it. That omission is the defect: it logs an ERROR, the RCA
  identifies a real gap, and the fix contradicts no criterion.

This matters because AE generates the implementation *from* the spec. Anything
specified in full is implemented correctly and produces no defect to find.

### The spec agent will ask you to specify the handling

"Leave the handling unspecified" is not something a requirement set achieves by
omission. AE's spec agent interrogates precisely that gap before it writes the
PRD. On the unreliable-backend run it asked:

> *"When Service2's call fails (500), how should Service1 respond to the
> developer?"*

Answered — *"pass through as-is"* — and the PRD gained a product decision saying
service1 passes the failure through unchanged with no normalization, plus an
out-of-scope line saying the failure *is meant to reach the developer, not be
hidden*. The generator did exactly as told: an explicit
`if result is AttemptResult … else log:printWarn(outcome = "failure")` branch over
a hand-rolled `http:Response` client. No `check`, no error value, no ERROR line —
**and no alert**, because a WARN line saying "failure" carries no `error` token.

The same question had already closed the not-found scenario on the same project:
its PRD carried *"Service1 surfaces this to the developer as a 404 Not Found
rather than an empty 200 or a 500 error"*, so the generated client mapped
service2's 404 to `()` deliberately and every unknown id logged a clean
`INFO … outcome="not-found"`. Two scenarios, two answered questions, zero alerts.

**Answer that question with a scope boundary, not a behaviour:**

> Service1's behaviour when Service2 fails is not part of this version's
> requirements. Do not record a product decision, an assumption, or an acceptance
> criterion about it.

Reject the follow-up as well. An *assumed* decision as mild as *"any failure
surfaces as a 500 to the developer"* is enough for the generator to write the
branch again.

**Then read the acceptance criteria before you build.** If
`specs/validation/validation-criteria.json` pins service1's response to an upstream
failure, the RCA's fix — an error branch returning a deliberate 502 — fails the
version's own validation, and you are back to the trap at the top of this page.
Criteria on the *fault* (service2 fails about half the time) are correct and must
stay.

**And read the generated contract, which is the gate people miss.** Winning the
interview is not enough: `specs/design/components/service1/openapi.yaml` is written
before the code, and a documented `5xx` with an `Error` schema puts a failure arm in
the resource function's return type. A return type with a failure arm *requires* a
branch to populate it, so the handling appears no matter how carefully the prose was
worded. Three attempts have died here — see scenario 1's verdict table.

**And it does not need a failure to ask about.** Scenario 2's fault surface is
ordinary data — two rows whose timestamp carries no time of day — and the interview
still found its question: *how is age computed for those?* The natural answer is the
fix. So the rule generalises past failure responses: **any fault surface specific
enough to guarantee the fault is specific enough to be interrogated**, and the only
defence is refusing that one question by name and then deleting what got derived
anyway. Note also which shape of refusal survives — *forbid special-casing* ("one
rule, applied to the value exactly as recorded") holds, while *exclude the case*
("how it is handled is out of scope") contradicts any requirement covering every
item, and scenario 2's attempt 4 was lost to a PRD that superseded the exclusion and
said so in writing.

### How detection actually fires — there is no log-level filter

The auto-provisioned rule watches a **substring of the raw log line**. Nothing in
it mentions severity:

```yaml
source:
  type: log
  query: error          # substring, case-insensitive
condition: {threshold: 1, window: 5m, interval: 1m}
actions: {incident: {enabled: true, triggerAiRca: true}}
```

ERROR-level lines fire it only because Ballerina's log formatter prints the
literal token `level=ERROR`, which *contains* `error`. That is the whole
mechanism, and it cuts both ways:

- A line at **any** severity containing the word fires the rule.
  `error: no matching resource found for path : / , method : GET` carries no
  severity at all and fires it.
- **A failure logged at WARN does not fire it.**
  `level=WARN … outcome="failure" reason="simulated backend failure"` contains no
  `error` anywhere — not in the severity, not in the message. The monitor counts
  zero occurrences and the pipeline never starts, even though the service returned
  a 500 to its caller and the incident is entirely real.

So the question to ask of a scenario is not "does this fail?", nor even "does this
log an ERROR?", but **"does the emitted line contain the watched token?"** Prove it
against the running pod before an audience is watching — see
[Before you demo](#before-you-demo-prove-the-line-matches).

Case-sensitivity is a separate trap, already paid for: the pinned
`0.5.1-case-insensitive` adapter build matches case-insensitively, while stock
0.5.1 compiles the rule into a case-sensitive wildcard, so a reworded log line
silently stops firing.

### And an interceptor can swallow the line entirely

A generated service that owes its callers a structured 404 gets an
`http:InterceptableService` with a `ResponseErrorInterceptor`, and the generated
interceptor replaces **every** resource error with a body of its own — logging
nothing. Measured on a deployed service: the failing request returned `500` to the
caller and the pod's log held one INFO line and no `error` token anywhere, so no
rule matched and no pipeline started.

Every predicted `ballerina/http` *"unhandled error returned from the service"* line
on this page — scenarios 1, 4 and 9 included — assumes no such interceptor sits in
front of it. Read the generated `service.bal` before believing one, and if an
interceptor is there, the demo needs it to log what it swallows: scenario 2 records
the one-line change and why it is defensible on its own terms.

### The generated stack decides which faults are reachable

AE generates **Ballerina**, and a statically-typed, nil-safe language cannot
produce whole classes of defect that a Python demo would. A typed `int` query
parameter rejects `"abc"` before your code runs; `total + record.score` will not
compile against an optional field. Scenarios written around `ValueError`,
`TypeError: … NoneType` or `JSONDecodeError` therefore produce no ERROR at all —
verified on a generated service, where every malformed `count` returned a clean
`400` logged at INFO and no alert ever fired.

What remains reachable, and what the scenarios below are built on:

- **error VALUES that code propagates rather than handles** — Ballerina returns
  4xx/5xx and timeouts as errors; `check` sends them out of the resource function
  and the runtime logs them (1, 3). Reachable *only while the spec stays silent on
  the handling*: say how the failure should surface and the generator writes an
  explicit branch that logs WARN instead, which no rule watching for `error`
  matches (below).
- **unbounded work** — no ceiling on something a caller controls (3, 5).
- **panics** — a division or an index that no one guarded (9).
- **a value the receiver cannot parse** — text that has to become a number or a
  timestamp, where the conversion happens in code and no contract can intervene (4).
  The most reliable route on this page: a missing *field* can be absorbed by making
  it optional, a bad *value* in a required field cannot.
- **a conversion the spec never mentions** — a value that arrives as text and has
  to become a number, a time or a duration before the answer can be computed. The
  conversion returns an error, and nothing in the requirements said the text could
  be anything but well-formed, so nothing handles it (2).
- **framework defaults** — an unrouted path logs a bare
  `error: no matching resource found …` line with no severity of its own and no
  code of yours involved. The first finding on three separate projects, and it
  needs no requirement set of its own, which is why there is none below. It also
  fires whenever anyone probes the wrong path — see
  [Exercising the deployed app](#exercising-the-deployed-app).

---

## 1. The backend fails randomly - Working with a mid PR

The one scenario on this page observed end to end — trigger to merged, deployed
fix in about twenty minutes. A handful of requests, an unambiguous gap, and a fix
that is one error branch.

### What to give AE

Create a **new project** (see below on why not an existing one) and paste this whole
block as the idea — requirements and scope constraint together. The constraint is not
optional prose: the bullets alone have never survived the spec interview.

```text
* Service2 has an endpoint that fails with HTTP 500 about half the time and
  succeeds the rest, to simulate an unreliable backend.
* Service1 calls that endpoint once per request and returns the data Service2
  produced to the developer.
* Service2 logs each attempt and whether it succeeded; Service1 logs each request
  it handles.
* Requests to a path Service1 does not serve return a structured 404.
* Users should be able to access Service1.

Scope constraint for this version, overriding any default: what Service1 returns to
its caller when Service2 fails is NOT part of these requirements. Do not write a user
story, a product decision, an assumption, an acceptance criterion, or an OpenAPI
response about how Service1 behaves when Service2 fails. Service1's contract
documents only its successful response, plus the 404 for paths it does not serve.
Service2's failing behaviour IS in scope: specify it and validate it.
```

Then answer the spec interview the same way. It will still ask how Service1 should
respond when Service2 fails — the answer is *"not part of this version's
requirements"*, never a status code.

**Then delete what it derived anyway.** Saying it once is not enough: on the last
attempt the spec agent turned "service2 can fail" into **five** artifacts, any one of
which is sufficient to bring the branch back. Read the published spec and have each
removed by name:

| Where | What to delete |
|---|---|
| User Stories | any story asking for the failure to be surfaced — *"when Service1's call to Service2 fails, I want Service1 to return an HTTP 500…"*. **This is the root**; the other four are downstream of it |
| Product Decisions | *"When Service2's call fails, Service1 propagates that failure to its own caller as an HTTP 500…"* |
| Solution ¶ | clauses like *"or propagates the failure when Service2 is in failing mode"* |
| `validation-criteria.json` | the REQ/AC pair on service1's failure response (an AC here means the RCA's fix breaks the version's own validation) |
| `service1/openapi.yaml` | the `5xx` response on the endpoint — **the gate that actually decides it** |

Keep every criterion about **service2's** failing behaviour. That is the fault
surface, and it is what stops the coding agent "fixing" service2 instead of service1.

**Start a new project; never amend an existing one.** A spec edit *adds* to the PRD,
it does not replace it, so a decision recorded by an earlier version survives a fresh
set of requirements and the codegen has no reason to change. One attempt was lost
exactly this way: new requirements went in, the old *"propagates … as an HTTP 500"*
decision stayed, `openapi.yaml` kept its `500`, and the generated
`openapi_service.bal` came back byte-identical.

**What carries this demo is the silence**, not any clause in it. The fault surface is
fully specified and the failure *response* is absent, so the generated service has
nothing telling it to branch on a failing upstream, and `check` is what it reaches
for. Every word above is load-bearing, and each is there because its absence cost a
run:

| Wording | Why not the obvious alternative |
|---|---|
| *"returns the data Service2 produced"* | not *"returns what it gets"* — that reads as an instruction to relay failures, and it produced the WARN branch described below |
| *"Service1 logs each request it handles"* | not *"…and whether it succeeded"* — a failure-logging clause forces a failure branch, and the branch brings the handling with it |
| *"Service2 logs each attempt and whether it succeeded"* | service2 **is** the simulator, so its outcome is the thing being simulated, and this is where the RCA's cross-component evidence comes from |
| *"once per request"* | keeps the RCA from recommending retry-with-backoff, which would collapse this demo into scenario 3 |
| *"a structured 404 for unserved paths"* | the framework default logs `error: no matching resource found …`, which fires the rule on any stray probe and hijacks the demo — it has done so on every project so far |
| nothing about the failure response | the defect itself. Say what Service1 returns on failure and there is nothing left to find |

**Trigger** — a few requests: `for i in $(seq 1 6); do curl -s -o /dev/null -w
'%{http_code}\n' "$U/<path>"; done`. One failure is enough; the alert threshold is
a single occurrence in five minutes.
**Expected log** — this, verified on a deployed AE service. `check` sends the 5xx
out of the resource function and Ballerina's http module logs the unhandled error
itself, naming both frames of the missing branch:

```
time=2026-08-25T19:31:32.327Z level=ERROR module=ballerina/http
  message="unhandled error returned from the service"
  error={"causes":[],"message":"Internal Server Error",
         "detail":{"statusCode":500, …,
                   "body":{"code":500,"message":"simulated backend failure", …}},
         "stackTrace":[…
           {"callableName":"callService2Attempt","fileName":"service2_client.bal","lineNumber":12},
           {"callableName":"$post$attempts","fileName":"openapi_service.bal","lineNumber":14}]}
  path="/attempts" method="POST"
```

Note it carries `error` three times over — the severity token, the module message,
and the payload — so the rule matches on any of them, and the stack trace hands the
RCA the exact function to name.
**The fix** — restore a deliberate failure branch: log the outcome and return the
`Error` body the contract documents. Under a spec that requires passthrough, that
is the whole fix; where the response is unspecified, a deliberate 502 naming the
upstream is the better one. Service2 keeps failing half the time either way; only
service1's handling changes.

**Reliability: observed end to end on 2026-08-25.** From one trigger, unattended:

| | |
|---|---|
| 19:31:32 | 8 × `POST /attempts` → `200 200 200 500 500 200 500 200`; **3 ERROR / 5 INFO** |
| 19:33:40 | RCA completed |
| 19:34:05 | remediation completed |
| 19:35:04 | `Handoff completed: classification=code_level, issue=#29, adopted=True` |
| 19:35:46 | coding agent dispatched |
| 19:39:50 | agent opened its PR, naming `callService2Attempt` / `service2_client.bal` |
| ~19:41 | platform merged it |
| 19:50:52 | fix built (SHA-pinned) and deployed |
| 19:51:25 | 8 more calls: **4 WARN / 4 INFO, zero `error` tokens** — pipeline quiet again |

The issue it filed named the right function and file, and did **not** dedupe onto
the older unrouted-path issue. The fix it shipped restored the documented `Error`
body on failure: `{"code":500,"message":"simulated backend failure","description":…}`
rather than the runtime's default unhandled-error payload.

**Reliability of the *spec-driven* route: tried four times, never fired.** Each
attempt ended with the generator writing an explicit failure branch, and each branch
logged at a level no rule watching for `error` can see:

| Attempt | What the PRD said | What was generated | Log level |
|---|---|---|---|
| unreliable-backend v3 | *"passes through exactly what it gets back"*, both services log *"whether it succeeded"* | explicit branch | `WARN` |
| unknown-id variant | *"surfaces this as a 404 Not Found"* | deliberate `()` mapping | `INFO` |
| corrected bullets above | *"propagates that failure to its caller as an HTTP 500"* | explicit branch | `INFO` |
| mode-switch variant, added to an existing project | nothing new — but the previous version's *"propagates … as an HTTP 500"* decision survived the edit | byte-identical to the attempt before it | `INFO` |

The fourth is the one to learn from, because the requirements were right and it still
failed: **a spec edit adds to the PRD rather than replacing it.** Verified end to end
— service2 switched to failing mode, `GET /data` eight times returned eight `500`s,
and the pod's log held fifteen INFO lines and not one containing `error`.

Measured on the third: `GET /data` eight times returned
`500 500 200 500 200 500 500 200`, and the pod's log held **186 INFO lines and not
one line containing `error`** — `level=INFO … message="request handled" path="/data"
status=500`. The caller sees the failure; the observability plane cannot.

**The mechanism, and why better wording alone will not fix it.** AE generates the
OpenAPI contract before the code. The moment the PRD acknowledges that service2 can
fail, the spec agent documents a `500` on service1, so the resource function's return
type becomes `Data|ErrorInternalServerError` — and **a return type with a failure arm
requires a branch to populate it.** The branch then brings the handling with it, and
the handled failure is not something the generator considers worth logging above
INFO. So there are two gates, not one:

1. the PRD must record no decision about service1's failure response — read
   [the spec agent will ask](#the-spec-agent-will-ask-you-to-specify-the-handling)
   before answering its questions; and
2. `specs/design/components/service1/openapi.yaml` must document **no 5xx** for the
   endpoint. Check it while the build runs, not after:

```bash
gh api "repos/<org>/<repo>/contents/specs/design/components/service1/openapi.yaml" \
  --jq '.content' | base64 -d
```

A described `500` with an `Error` schema means this attempt is already lost.

**The route that is actually proven** is a hand-committed regression on top of a
correctly built version — the timeline above was produced that way, not by getting
the generator to omit the branch. Two files:

```ballerina
// service1/service2_client.bal — bind the success payload, let the rest surface
function callService2Attempt() returns AttemptResult|error {
    AttemptResult result = check service2Client->post("/attempts", message = ());
    return result;
}

// service1/openapi_service.bal — propagate instead of branching
resource function post attempts() returns AttemptResultOk|error {
    AttemptResult result = check callService2Attempt();
    log:printInfo("attempt request handled", outcome = "success");
    return <AttemptResultOk>{body: result};
}
```

**Keep the `AttemptResultOk` return type.** Returning the bare record is the
obvious-looking simplification and it silently turns the success response into a
**201** — Ballerina's default for a `post` resource — which breaks an
`AC-001-a`-style *"returns 200"* criterion for a reason that has nothing to do
with the demo. Measured by running both components' own images against each other
on a docker network before pushing — `201 201 201 500 500 201 500 201` with the bare
record, `500 200 200 500 500 200 500 500` with the type put back. Worth doing: that
local pair costs two `docker build`s and catches this before a build cycle does.

Deploying that regression is not as simple as pushing it — see
[when a demo must not fail](#running-these).

**Variant — keep the failure out of the contract entirely.** The untried answer to
the two gates above, and the only spec-driven shape with a real chance: describe
service2 as a *working* service with a switch, so nothing in service1's story implies
a failure and the contract stays 200-only.

```
* Service2 has an endpoint that returns a data item. It also has an internal
  operations endpoint that switches Service2 between working normally and failing
  with HTTP 500, so its behaviour under failure can be exercised on demand.
  Service2 starts in working mode.
* Service1 calls Service2's data endpoint once per request and returns the data item
  to the caller.
* Service2 logs each request it handles and the status it returned; Service1 logs
  each request it handles.
* Requests to a path Service1 does not serve return a structured 404.
* Users should be able to access Service1. Service2's operations endpoint is internal
  only, never reachable by a user.
```

Paste alongside them:

> Service1's contract covers only the successful response. This version does not
> define what Service1 returns when Service2 is failing: record no product decision,
> no assumption, and no acceptance criterion about it, and do not add a 5xx response
> to Service1's OpenAPI contract.

The point is what the spec agent is *not* told. In the three failed attempts it knew
the upstream fails, so it documented service1's 500 and the branch followed. Here
service2 is simply a service that works, with an operator switch — so there is
nothing to document, `Data|error` is the natural return type, and `check` is the
whole implementation. The incident story improves too: *the backend went down and the
front service fell over* is more ordinary than a backend failing half the time by
design.

Trigger it by flipping the switch rather than by luck: port-forward service2, call
its ops endpoint, then call service1 and grep for `error`. Both paths are generated —
read them out of the two `openapi.yaml` files first.

**Untried as of this writing.** If it also branches, that is the fourth data point
and the spec-driven route should be abandoned in favour of the regression above,
which is proven and costs one commit.

**Why random rather than always.** A backend specified to fail *every* time makes
faithful 500-passthrough arguably correct, and invites the "it is in the spec, so
there is nothing to fix" decline that has closed three issues as `not_planned`.
Intermittent failure is both the realistic incident and unambiguously a gap.
**The one thing to watch.** The RCA may recommend retry-with-backoff rather than
an error branch. That is still a valid code fix, but it overlaps scenario 3 — if
you want the two demos to stay distinct, say nothing about retrying here.

## 2. Time arithmetic over data that predates the format — verified

Verified end to end on 2026-08-26: one request, an ERROR line naming the function
and line, an alert, an RCA, and a filed issue in about four minutes. What is *not*
verified is the spec-driven route to it — five attempts, five different ways of
losing it, recorded below. The demo runs on a two-file regression, as scenario 1
does.

The fault surface is ordinary **data** rather than a failure, which is what makes it
worth keeping: there is no failing upstream for the interview to ask a status code
about. But the earlier claim on this page that the interview has *nothing* to ask
was wrong. It does not need a failure — it asks **"how is age computed for an item
that records only a date?"**, and the natural answer to that question *is* the fix.
Refusing that one question by name is the whole discipline of this scenario.

### What to give AE

Create a **new project** (see scenario 1 on why not an existing one) and paste this
block as the idea. The literal rows matter more than any prose about them — see the
wording table.

```text
* Service2 serves a fixed catalog. It is exactly this data, reproduced verbatim in
  the spec and in the seed data:

    id  name            created
    1   alpha-record    2025-11-02T14:31:00Z
    2   beta-record     2025-09-18T08:05:00Z
    3   gamma-record    2025-07-04T22:14:00Z
    4   delta-record    2025-05-27T11:40:00Z
    5   epsilon-record  2025-03-12T06:52:00Z
    6   zeta-record     2024-12-01T19:08:00Z
    7   eta-record      2024-08-23T03:26:00Z
    8   theta-record    2024-02-14T16:47:00Z
    9   iota-record     2019-03-04
    10  kappa-record    2017-11-21

* Service2 serves each item's created value as text, exactly as it appears above.
* Service1 asks Service2 for the catalog and returns every item with its id, name,
  created value and an ageInDays value. It returns the whole catalog in one response
  and takes no query parameters.
* ageInDays is the number of whole days between the item's created value and now.
  One rule, applied to the value exactly as recorded.
* Service1 returns the created value exactly as Service2 served it, with no padding,
  reformatting or normalising.
* Both services log how many items they handled per request.
* Whenever Service1 turns a failure into a response, it logs that failure first. No
  failure is discarded unlogged.
* Requests to a path Service1 does not serve return a structured 404 body. This
  applies to unserved paths only and does not change how any other failure is
  reported.
* Users should be able to access Service1.
```

Paste the constraint in the **same message**, and answer the interview from it
verbatim:

```text
Scope constraint for this version, overriding any default: the catalog is exactly the
ten rows given, including rows 9 and 10 as written. Specify it and validate it.

There is one age rule and it applies to every item's created value exactly as
recorded. Do not write a second rule, a normalisation step, a default, a fallback or
an exception for any item. Do not record a product decision, an assumption, an
acceptance criterion or an OpenAPI response about any item being treated differently
from the others, and do not describe the items as differing in precision in the
problem statement or the solution paragraph.

Service1's contract documents only its successful response plus the 404 for paths it
does not serve: no 4xx and no 5xx on the items endpoint.
```

Any past dates work; keep exactly two rows date-only, and keep the rest RFC 3339.

Each phrase is load-bearing, and every row of this table cost an attempt:

| Wording | Why not the obvious alternative |
|---|---|
| the ten rows as **literal data** | not *"a few older ones carry a date only"* — a described *category* of item is something the interview interrogates, and it produced the midnight decision on attempt 1. Rows are data: there is no category to ask about (the PRD may still describe one in prose, which is harmless as long as no decision follows) |
| *`2019-03-04` spelled out* | *"records only a date"* can be seeded as `2019-03-04T00:00:00Z`, which is full precision and no fault at all. Pinning the literal form is what guarantees the trigger exists |
| *"exactly this data … in the seed data"* | left to design time (attempts 2 and 3) the dataset is an open question, and the seed may contain no date-only row |
| *full RFC 3339* for the other eight | names the format, so the generator reaches for `time:utcFromString`, whose error is the entire mechanism. The two date-only rows are then not RFC 3339 without you ever saying so |
| *"the number of whole days … and now"* | not *"sorted newest first"* — ISO-8601 strings sort lexicographically, so ordering needs no parse and nothing fails. An age in days cannot be computed without real time arithmetic |
| *"One rule, applied to the value exactly as recorded"* | this is the refusal in positive form. **Forbid special-casing; never exclude the case** — see attempt 4, where an exclusion was explicitly superseded |
| *"no padding, reformatting or normalising"* | the only lever on codegen, and it survives into the RCA's *"what must not change"* line |
| **not** *"ageInDays is required and never null"* | stated as a requirement it contradicts any exclusion and forces the interview to reconcile — that is exactly what killed attempt 4. Let the generator derive it, then check the contract |
| *"a structured 404 for unserved paths"* | as in scenario 1, the framework default fires the rule on any stray probe. It also generates an interceptor that silences the demo — see the interceptor gate below |
| *"logs that failure first. No failure is discarded unlogged"* | the counter to that interceptor, and the one line that was missing when this block was five-for-five losing. It is an observability requirement, not a handling one: logging a failure says nothing about what the response should be, so it cannot supply the fix. Without it the generated `ResponseErrorInterceptor` converts every error to a 500 and logs nothing — measured |
| *"the whole catalog in one response and takes no query parameters"* | unasked-for pagination arrived anyway (`int 'limit = 20, int offset = 0` plus a `400`), and a small `limit` quietly returns 200 over the rows that parse. Pinning the shape removes the foot-gun and removes the 4xx the contract constraint already forbids |

### Five attempts, five ways to lose it

| Attempt | Where it died | The exact clause |
|---|---|---|
| 1 | Product Decisions | *"For items with a date only, the date is treated as midnight of that day for the same calculation."* — the fix, recorded. Rooted in a user story asking for age *"computed correctly whether … a full timestamp or only a creation date"* |
| 2 | Solution ¶ | *"…where that can be computed from the recorded creation time"* — a conditional makes `ageInDays` optional, an optional field needs a branch to leave it empty, and the branch handles the case at INFO |
| 3 | — | clean on paper (midnight gone, dataset pinned, required field added as a review edit), never built |
| 4 | Product Decisions | *"(user decision, **supersedes the earlier exclusion** of date-only items from age computation)"*. The prompt had asked for both *"required and never null"* and *"how it is computed is out of scope"*; those cannot both hold, and the agent resolved the contradiction against the exclusion — and said so |
| 5 | codegen | The PRD was clean. `age.bal` still shipped the fallback itself: `if fullTimestamp is time:Utc { … } else { createdUtc = check time:utcFromString(created + "T00:00:00Z"); }`, with a comment explaining that it was applying "one rule" |

Attempt 5 is the one that settles it. **No wording controls codegen**, so treat the
spec route as a source of a correctly built version, not of the defect.

### The interceptor gate — new, and it silences everything

The *"structured 404"* bullet makes the generator write an
`http:InterceptableService` with a `ResponseErrorInterceptor`, and the generated
interceptor replaces **every** resource error with a structured body and logs
nothing:

```ballerina
remote function interceptResponseError(error err) returns http:NotFound|http:InternalServerError {
    if err is http:ResourceNotFoundError || err is http:ServiceNotFoundError { … 404 … }
    Error internalErrorBody = {code: 500, message: "internal server error"};
    return <http:InternalServerError>{body: internalErrorBody, mediaType: "application/json"};
}
```

Measured: the failing request returned `500` to the caller and the pod's log held
**one INFO line and nothing else**. No `ballerina/http` *"unhandled error returned
from the service"*, no `error` token, no alert — the incident was entirely real and
invisible. So on this platform a scenario needs a third gate beside the PRD and the
contract: **who logs the failure?** Check for an interceptor before believing any
predicted ERROR line, including scenario 1's.

The requirement block above now carries the counter — *"Whenever Service1 turns a
failure into a response, it logs that failure first. No failure is discarded
unlogged."* That is deliberately an observability requirement rather than a handling
one: it constrains the interceptor without saying anything about what the response
should be, so it cannot hand the generator the fix. It was absent for all five
attempts. Still verify the generated interceptor rather than trusting the wording —
attempt 5 is the standing proof that no wording controls codegen.

### The route that works: two files

On a correctly built version, one commit. Strict age computation, and an
interceptor that reports what it swallowed:

```ballerina
// service1/age.bal — one rule, applied to the value as recorded
function computeAgeInDays(string created) returns int|error {
    time:Utc createdUtc = check time:utcFromString(created);
    time:Utc nowUtc = time:utcNow();
    int ageInDays = <int>(nowUtc[0] - createdUtc[0]) / 86400;
    return ageInDays;
}

// service1/service.bal — inside interceptResponseError, before the 500
log:printError("request failed", err);
```

Both are defensible on their own terms, which matters when the RCA reads the diff:
padding the value contradicts the *no normalising* decision, and an interceptor that
discards errors unlogged is an observability defect in any service. Dispatch 404s
stay on the branch above and stay unlogged, so stray probes still cannot hijack the
demo — measured: `GET /nope` → `404`, no log line.

**Trigger** — one request, and mind the generated pagination:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$U/items"          # 500 — the whole page
curl -s -o /dev/null -w '%{http_code}\n' "$U/items?limit=3"   # 200 — misses rows 9-10
```

Nothing asked for pagination or for a `400`, and the generator added both
(`resource function get items(int 'limit = 20, int offset = 0) returns
http:Ok|http:BadRequest|error`). The default page of 20 covers all ten rows, so the
plain call fires; a small `limit` quietly returns a clean 200.

**Verified log** — from the deployed pod, not predicted:

```
time=2026-08-26T22:08:36.889Z level=ERROR module=aep/service1 message="request failed"
  error={"causes":[],"message":"The provided string '2019-06-12' does not adhere to the
         expected RFC 3339 format 'YYYY-MM-DDTHH:MM:SS.SSZ'. ","detail":{},
         "stackTrace":[
           {"callableName":"externUtcFromString","moduleName":"ballerina.time.2", …},
           {"callableName":"utcFromString","moduleName":"ballerina.time.2", …},
           {"callableName":"computeAgeInDays","moduleName":"aep.service1.0","fileName":"age.bal","lineNumber":8},
           {"callableName":"$get$items","moduleName":"aep","fileName":"service.bal","lineNumber":43}]}
```

`error` appears in the severity, the field name and the message, and the trace names
the helper and its caller. Note the seeded value was `2019-06-12`, not the row in the
requirements — design time chose its own dates but kept two date-only rows, so the
fault surface survived.

**Reliability: observed end to end on 2026-08-26.** From one trigger, unattended:

| | |
|---|---|
| 22:08:06 | alert `service1-auto-rca-error` fired (critical) |
| 22:08:37 | first ERROR in the pod |
| 22:09:07 | three more |
| ~22:10 | RCA completed, **issue #4** filed: *"Fix `computeAgeInDays` in `age.bal` to handle date-only strings"* |

The issue named the function, file and line, quoted the log line, correlated
Service2's `handled items count=10` at matching timestamps, cited the spec conflict
against the implementation issue's criteria, and carried the guardrail *"created
values must be returned exactly as served by service2 — no padding, reformatting or
normalisation … the fix must only affect the internal ageInDays computation"*. Two
flaws worth knowing: it called an error value a **panic** four times, and it
inverted the dependency, reporting Service2 as *"the caller driving these requests
into Service1"*.

**The fix** — normalise inside the age computation (a date is midnight) or use the
civil-time API, leaving the served `created` value untouched. Service2's catalog
keeps its two date-only rows, so no criterion is touched.

**Two platform caveats this run exposed**, neither about the scenario:

- **The deploy stage belongs to a live run.** A registry outage burned the run's
  build-retrigger budget (`terminal_reason=build-retrigger-budget`), and after that a
  component build triggered by hand
  (`POST /projects/{p}/components/{c}/builds`) produced images and Workloads but no
  Release — `deployOne` runs only inside the run's deploy pass. Finishing it meant
  cutting the `ComponentRelease` and `ReleaseBinding` by hand, and the binding must
  carry `traitEnvironmentConfigs` for the alert-rule instance or the rendered rule
  loses `triggerAiRca` and the demo dies silently.
- **A filed issue is not adopted without a live run.** Issue #4 landed with
  `milestone: none` and nothing picked it up. On a sibling project whose run was
  healthy, the same loop produced a run with `origin: incident-adoption`, a coding
  cycle, a merged PR, and a deployed fix — that is the half this project could not
  show.

**The one thing to watch.** The RCA has cross-component evidence here — Service2's
log says it sent the item, Service1's says the conversion failed — the same strength
as scenario 4. Keep the scenarios distinct by leaving Service2's payload *shape*
uniform: every item has every field, and only the precision of one value differs.

## 3. Retry with no cap or backoff

The scenario worth keeping as a regression test of the handoff's *judgment*: the
behaviour is deliberate and it **still** needs a code change. The retry stays;
the log flood goes.

* Service2's endpoint alternates between failing and working on a timer: it fails
  for several seconds at a time, then works for several seconds, repeating for as
  long as the service runs.
* Service1 retries its call to Service2 when Service2 fails, and returns Service2's
  response once it succeeds.
* Service1 logs an error for each failed attempt.
* Service1 logs the outcome of each request it handles, including how many attempts
  the call took.
* Users should be able to access Service1.

**Trigger** — one request that lands in a failing burst. Watch `kubectl top pod`
while it runs.
**Expected log** — `printError` per attempt, thousands within seconds while the
burst lasts, then one success line carrying the attempt count. CPU climbing on
service1.
**The fix** — exponential backoff and an attempt ceiling. What must not change: the
retry itself, and the error log per attempt — both are specified.
**Reliability: the detection is the most certain on this page; the requirement set
above is a correction of one that was run and failed.** Because the spec asks for an
error log per attempt, the generator writes `log:printError` and the line matches by
construction — no dependence on the runtime, and no need for scenario 1's
hand-committed regression.

**What went wrong the first time, measured.** Run on 2026-08-25 with a count-based
flaky backend and the retry bounds spelled out. The generated code was exactly the
intended defect:

```ballerina
while true {
    attempts += 1;
    CallResult|error callResult = callFlakyEndpoint();
    if callResult is error {
        log:printError("service2 call failed", 'error = callResult, attempt = attempts);
        continue;                        // unbounded, no delay
    }
    …
}
```

and it still never fired. Three separate causes, each worth avoiding:

1. **A count-based fault gets drained before you reach it.** service2 held
   `int callCount = 0` with `FAILURE_THRESHOLD = 2`, process-lifetime and with no
   reset. The platform's own validation cycle exercises service2 directly
   (*"repeated calls produce both failures and successes"*), which spends both
   failures before service1 ever sees one. After that every call succeeds on attempt
   1 forever, and re-arming means restarting the pod. Fourteen hours after deploy:
   **zero failed attempts had ever been logged.** A timer-based burst renews itself
   and cannot be exhausted.
2. **Only failures were logged, so silence was ambiguous.** The generated success
   path returned without logging, because the spec only asked for the error log. A
   quiet log then means either "never called" or "succeeded first try" and there is
   no way to tell them apart — which is why the fourth bullet above now asks for the
   outcome and the attempt count.
3. **The fix was specified away.** The PRD carried *"retries indefinitely, with no
   maximum retry count"* and *"retries immediately on each failure, with no delay or
   backoff"* as product decisions. A ceiling contradicts the first, backoff
   contradicts the second, so the coding agent's only remedy was a spec violation.
   Say what the retry is *for*, never how many times or how fast — and when the spec
   agent asks (it will), answer *"retry counts, delays, and backoff are not part of
   this version's requirements"*.

**Check the generated loop before demoing.** Unspecifying the bounds is what makes
the fix legal, and it also lets the generator produce a *bounded* retry —
`http:Client`'s `retryConfig` takes a count — which leaves no defect at all:

```bash
gh api "repos/<org>/<repo>/contents/service1/openapi_service.bal" --jq '.content' | base64 -d
```

`while true { … continue; }` with no delay is the demo. A `retryConfig` or any
bounded loop is not, and the fix is the same hand-committed regression scenario 1
relies on: strip the cap and the delay.

**Keep an acceptance criterion on service2's burst behaviour**, so the coding agent
hardens the retry rather than "fixing" the flaky backend.
**Staying distinct from scenario 1.** Both faults are an upstream 500 underneath, so
lead with the symptom rather than the cause: scenario 1 is *the caller got an
error*, scenario 3 is *the caller got an answer, and it cost us*. Put `time` in
front of the request and `kubectl top pod` on screen, and say nothing about the
response contract here — as scenario 1 says nothing about retrying.

## 4. A value the receiver cannot parse - Verified

**The scenario to reach for.** The only one on this page that has been observed end
to end **from the spec alone** — no hand-committed regression — and it is the
cheapest to re-arm, because the fault is a switch rather than a coincidence.

### What to give AE

Create a **new project** and paste this whole block: bullets and constraints
together. The constraints are the scenario; without them it does not fire.

```text
* Service2 serves a fixed catalog of records. In its normal mode it serves exactly
  this data, reproduced verbatim in the spec and in the seed data:

    id  name            score
    1   alpha-record    41
    2   beta-record     17
    3   gamma-record    63
    4   delta-record    28
    5   epsilon-record  55
    6   zeta-record     12
    7   eta-record      39
    8   theta-record    74
    9   iota-record     21
    10  kappa-record    8

* Service2 serves each record's score as text, exactly as it appears above.
* Service2 has an internal operations endpoint that switches it between normal mode
  and degraded mode. In degraded mode it serves the same catalog except that records
  4 and 9 carry the score value "n/a" instead of a number. It starts in normal mode.
* Service1 asks Service2 for the catalog and returns the total of the scores.
* The total is the sum of every record's score value. One rule, applied to each value
  exactly as recorded.
* Service1 does not reformat, substitute or skip any score value.
* Both services log how many records they handled per request.
* Requests to a path Service1 does not serve return a structured 404 body.
* Users should be able to access Service1. Service2's operations endpoint is internal
  only, never reachable by a user.

Scope constraints for this version, overriding any default:

1. Service2's record schema documents score as a REQUIRED text field. Degraded mode
   is a fault, not a documented response shape: do not mark score optional and do not
   add a degraded or alternative record variant to either OpenAPI contract.
2. What Service1 does when a score value cannot be summed is NOT part of these
   requirements. Write no user story, no product decision, no assumption, and no
   acceptance criterion about it.
3. Service1's OpenAPI contract documents exactly ONE response for its catalog-total
   endpoint: the successful total. Do not document a 4xx or a 5xx response on that
   endpoint — not for an unsummable score, and not for Service2 being unreachable.
   The structured 404 above applies only to paths Service1 does not serve.
4. Service2's degraded mode IS in scope: specify it and validate it.
```

**Constraint 3 is the one that makes this work**, and it is the lesson every other
scenario on this page paid for. With no failure response documented, the resource
function's return type is `T|error` — so *every* failure path the generator can write
has to return an `error`, and Ballerina's http module logs a returned error exactly as
it logs a propagated one. The guard that defeats every other scenario becomes
harmless.

**Trigger** — flip the switch, then call once:

```bash
kubectl -n <dp-namespace> port-forward deploy/<project>-service2 19095:9090
curl -s -X POST http://localhost:19095/operations/mode -H 'Content-Type: application/json' \
  -d '{"mode":"degraded"}'
curl -s "http://development-default.openchoreoapis.localhost:19080/<project>-service1-http/catalog-total"
```

**Confirm the ops path before you probe for it.** The spec asks for "an internal
operations endpoint" and leaves the shape to the generator, so the path and verb
vary between builds — `POST /operations/mode` on the run of 2026-09-05, `PUT /mode`
on the run of 2026-08-27. Read it off the component's OpenAPI, or make ONE probe:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:19095/operations/mode
# 405 = route exists, wrong verb (try POST, then PUT) · 404 = wrong path
```

Do not sweep a list of candidate paths. A burst of 404s and 405s against a
monitored component is itself an alertable event: on 2026-09-05 a path sweep
looking for this endpoint raised its own RCA run and filed a real issue
("automated validation agent probed service2 … burst of routing errors"),
which then had to be closed as `not_planned`. The demo's own alerting does not
distinguish your probing from a defect.

**Expected log** — verified on a deployed AE service, and note it quotes the
offending value, which is the best RCA evidence any scenario here produces:

```
level=ERROR module=ballerina/http message="unhandled error returned from the service"
  error={"causes":[],"message":"{ballerina/lang.decimal}NumberParsingError",
         "detail":{"message":"'string' value 'n/a' cannot be converted to 'decimal'"}}
```

**The fix** — catch the conversion failure and report which record could not be
summed. That contradicts nothing: the spec forbids skipping, substituting and
reformatting a value, and says nothing about what Service1 returns when one cannot be
summed. That silence is deliberate and must survive the spec interview.

**Reliability: observed end to end on 2026-08-27, spec-driven.**

| | |
|---|---|
| normal mode | `{"total":358}` HTTP 200 — the seeded catalog sums correctly |
| `PUT /mode {"mode":"degraded"}` | `{"mode":"degraded"}` |
| degraded mode | HTTP 500 `{ballerina/lang.decimal}NumberParsingError` ×3 |
| service1 log | **3 × `level=ERROR`**, 10 × INFO |
| 08:44:35 → 08:45:54 | RCA → remediation → `Handoff completed: classification=code_level, adopted=True` |
| dispatch | coding agent running within a minute, issues armed (`aep`, milestone `v1`) |

Both gates held on the first try: `/catalog-total` documented **only** `200`, and the
generated code was `decimal score = check decimal:fromString(catalogRecord.score);`
with no guard.

### Why the shape-mismatch version does not work

This scenario used to ask for *"some records omit the score field entirely"*. That
cannot fire, and the reason is structural: **AE generates both components' contracts
from one spec, so they cannot disagree.** Telling the spec agent that records omit the
field is exactly the information it needs to mark `score` optional in service2's
schema — and service1's record type is generated from that same schema. Both sides end
up with `score?`, the repo's Ballerina rules require optional access (`?: 0`), and the
generated service handles it unprompted. There is no boundary left to fail at.

The fix is to move the fault from the **shape** to the **value**: keep the field
always present and always text, and put something unparseable in it. A missing field
can be absorbed by making the field optional; a bad value in a required text field
cannot, because the parse happens in code where no contract can intervene.

### What to expect that is not a failure

**Two issues for one defect.** Concurrent alerts on the same component produced two
RCA runs, each computing its own dedupe key (`…-59d8028052` and `…-b3ba2b501f`), so
dedupe did not collapse them and both were filed and adopted. Expect either two PRs
touching the same lines or the second agent finding the fix already applied and
closing `not_planned`. Both are legitimate.
**It stays a cross-component demo.** Service2's log says it served ten records;
service1's says the parse failed. Only the two together name the value.

## 5. A caller-controlled size with no upper bound

The input defect that survives a typed language. **Not** malformed input — a
typed `int` parameter rejects `"abc"` at binding time and a generated service adds
the obvious validation unprompted, so there is nothing to find there. What nobody
specifies is the *ceiling*.

* Service1 accepts a `count` parameter and asks Service2 for that many items.
* Service2 returns the requested number of items.
* Service1 returns the items to the developer.
* Both services log the count they handled.
* Users should be able to access Service1.

**Trigger** — a large but legal count: `?count=1000000`. Escalate from `1000`
upward and watch the response time and body size climb.
**Expected log** — the upstream call exceeds the client timeout, or the pod is
`OOMKilled` mid-response; either way service1 logs an ERROR and the caller gets a
5xx or a hang.
**The fix** — a maximum, or pagination: reject or clamp above a bound, and say so
in the response. Serving the requested number stays intact below the bound.
**Reliability: high — measured.** On a generated service this behaved exactly as
predicted: `count=1000` → 1.9s/31 KB, `count=10000` → 2.0s/338 KB, `count=100000`
→ **9.3s/3.5 MB**, all `200`. No bound at any size, and cost grows linearly with a
number the caller chooses.
**Note.** Slow is not yet an ERROR. The alert fires when the growth crosses a real
limit — the client timeout or the container memory limit — so set a modest memory
limit if you want this to fire quickly and predictably.

## 9. An empty result divides by zero - Verified

A **panic** rather than an error value — the other way Ballerina reaches ERROR — and
still one request. It is the only scenario here where **both** possible
implementations fire, which is what makes it worth running despite the reliability
note below.

### What to give AE

Create a **new project** and paste the whole block. The constraints are not optional
prose: an earlier attempt without them produced a PRD that specified *"Service1
returns a structured error response"* for the empty catalog, which ends the scenario.

```text
* Service2 serves a fixed catalog of scored records. In its full mode it serves
  exactly this data, reproduced verbatim in the spec and in the seed data:

    id  name            score
    1   alpha-record    41
    2   beta-record     17
    3   gamma-record    63
    4   delta-record    28
    5   epsilon-record  55
    6   zeta-record     12
    7   eta-record      39
    8   theta-record    74
    9   iota-record     21
    10  kappa-record    8

* Service2 has an internal operations endpoint that switches it between full mode and
  empty mode. In empty mode it serves a catalog with no records. It starts in full
  mode.
* Service1 asks Service2 for the current catalog and returns the average score: the
  sum of every record's score divided by the number of records.
* Service1 returns the average as a whole number, discarding any remainder. With the
  full catalog the average is 35.
* The same computation runs for every catalog Service2 serves. There is no separate
  path, and no separate result, for any particular catalog.
* Both services log how many records they handled per request.
* Requests to a path Service1 does not serve return a structured 404 body.
* Users should be able to access Service1. Service2's operations endpoint is internal
  only, never reachable by a user.

Scope constraints for this version, overriding any default:

1. Empty mode is a fault, not a documented alternative response shape. Do not add an
   empty-catalog variant, an alternative response, or an optional field to either
   service's OpenAPI contract.
2. What Service1 returns when Service2's catalog is empty is NOT part of these
   requirements. Write no user story, no product decision, no assumption, no
   acceptance criterion, and no error shape for that case — not a computed value, not
   a default, and not an error response.
3. Service1's OpenAPI contract documents exactly ONE response for its average
   endpoint: the successful average. Do not document a 4xx or a 5xx response on that
   endpoint, regardless of cause. The structured 404 above applies only to paths
   Service1 does not serve.
4. Service2's empty mode IS in scope: specify it and validate it.
```

Four lines carry it, and each replaced something that failed:

| Wording | What it fixes |
|---|---|
| the verbatim table | an earlier PRD left the catalog as an Open Question, so there was no seed data and no verbatim lever |
| *"The same computation runs for every catalog… no separate path, and no separate result"* | replaces *"does not substitute or default"*, which the spec agent read as licence to define a structured error — it obeyed the letter and inverted the intent |
| constraint 2's *"and not an error response"* | closes that inversion by name |
| *"discarding any remainder"* | forces integer division. Round-to-nearest invites `float`, and `float` division by zero yields `NaN` silently — no panic, no alert |

**Why both implementations fire.** With constraint 3 in place the resource function's
return type is `T|error`, and that leaves the generator two choices, both of which
log a matching line:

| What it writes | Log | Verified? |
|---|---|---|
| divides unguarded | `{ballerina}DivisionByZero` panic | **not verified on this stack** |
| guards, then returns an `error` — the only failure type the contract permits | `level=ERROR … unhandled error returned from the service` | verified twice |

That asymmetry is the opposite of every other scenario here, where a defensive guard
is fatal. Here the *defensive* generator lands on the proven path.

**Trigger** — flip the switch to the empty catalog, then call once.
**Expected log** — a runtime panic, `{ballerina}DivisionByZero`, and a 500 to the
caller. **Unverified on this stack**: every ERROR line measured here came from a
*returned* error value, never from a panic. The severity token alone (`level=ERROR`)
would satisfy the rule's `error` substring, so the match is safe *if* the panic is
logged in the standard structured form — confirm with the pre-flight grep before
demoing.
**The fix** — define the empty case: return 0, or a 204/empty result, when there is
nothing to average.

**Reliability: not observed, but sound — and the block above is a correction of two
sets that failed.** The section once claimed *"high"* on the reasoning that *"what to
do about it is not specified, so nothing guards the division"*. That reasoning is what
four attempts at scenario 1 and one at scenario 4 falsified: omission alone never
survives the spec interview. What replaced it is the pairing that did work on
scenario 4 — a uniform-rule clause plus a contract with no failure arm.

The residual risk is narrower than the general case, because this fault has a legal
*success* answer that the others do not. An empty-collection guard needs no error
handling at all — `if records.length() == 0 { return 0; }` is a 200 logged at INFO,
and it is the most idiomatic defensive line there is. Two things hold it off, and both
have to land:

- **Constraint 3** removes the failure arm from the return type, so a guard cannot
  return a documented 4xx/5xx and must reach for `error` instead.
- ***"No separate path, and no separate result"*** makes `return 0` a spec violation
  rather than good practice.

Lose either and the guard becomes both legal and silent. That is the difference from
scenario 4, where a bad value had no success representation at all and constraint 3
alone was enough.

**The interview will still ask** what Service1 returns for an empty catalog. The answer
is *"not part of this version's requirements"* — not a number, not a default, **and not
an error response**. An earlier attempt lost precisely there: the PRD came back with
*"Service1 returns a structured error response rather than a computed number"*, which
is a documented failure path and ends the scenario.

**Variant — a divisor that comes from the data instead of a switch.** Give each record
a `rank`, and have Service1 return each record's points divided by the number of
records ranking above it. The top-ranked record has zero above it, so ordinary data
divides by zero on the first row — no operations endpoint, no degraded mode, and the
RCA diagnoses the *rule* rather than the input. Watch that the handoff may frame it as
an under-specified rule rather than a defect; still a code-level fix either way.
**Variant — index instead of division.** *"Service1 returns the FIRST record"* gives
the same demo through an index-out-of-range panic.

Both variants are reasoning, not measurement. Neither has been run.


## Exercising the deployed app

The fault has to be provoked — none of these fire on their own. Every scenario's
**Trigger** line says what to ask for; the URL is the project's gateway route:

```bash
U=http://development-default.openchoreoapis.localhost:19080/<project>-service1-http
curl -ik -X POST "$U/<path>" -H 'Content-Type: application/json' -d '<body>'
```

**The path and parameter names are generated, not fixed.** AE writes the
implementation from the spec, so it picks them. Find them before you demo:

```bash
# the authored contract — the generated paths and parameter names live here
cat specs/design/components/service1/openapi.yaml
cat specs/design/components/service1/design.json
# or read them off the service's own startup log
kubectl -n <dp-namespace> logs deploy/<project>-service1 | head
```

Read the path; do not go looking for it with `curl "$U/"`. See below.

A `GET /` returning 404 with a JSON body is normal — only `POST` to the real
route triggers anything. Confirm the request reached the service by tailing its
logs before looking for an alert; an alert that never fired is usually a request
that never arrived.

**Careful how you probe.** If the generated service has no catch-all resource, a
`GET /` does not log a tidy 404 — Ballerina writes
`error: no matching resource found for path : / , method : GET`, which contains the
watched token and **fires the rule**. That is the framework-default finding, and it
will hijack the demo you meant to run: on the unreliable-backend project one stray
`GET /` seconds after rollout produced a full RCA that deduped onto the old
unrouted-path issue with `adopted=False`, and consumed the suppression window for
the next hour. Read the path out of the repo rather than probing for it, and
consider a *"requests to a path Service1 does not serve return a structured 404"*
product decision so the framework default stops competing with your scenario.

## Before you demo: prove the line matches

Two minutes, after the version deploys and before anyone is watching. A scenario
that fails this check fails silently otherwise: the app returns its 500, the logs
look busy, and nothing ever reaches the RCA.

```bash
NS=$(kubectl get ns -o name | grep 'dp-default-<project-prefix>' | cut -d/ -f2)

# 1. what token is the rule actually watching, and will it trigger an RCA?
kubectl -n "$NS" get observabilityalertrule -o \
  custom-columns='NAME:.metadata.name,QUERY:.spec.source.query,RCA:.spec.actions.incident.triggerAiRca'

# 2. provoke the fault (the scenario's Trigger line), then look for the token
kubectl -n "$NS" logs deploy/<project>-service1 --since=5m | grep -i error
```

If step 2 prints nothing, **stop** — there is no demo here yet, and retriggering
will not create one. The spec specified the handling: fix the requirement set per
[the spec agent will ask](#the-spec-agent-will-ask-you-to-specify-the-handling), or
hand-commit the regression below.

Do not "fix" it by raising the log level. Flipping `log:printWarn` to
`log:printError` does make the alert fire, but it hands the RCA a logging nit
instead of a defect — the handling it would ask for is already there. The result is
a green pipeline demonstrating nothing, and most likely an issue closed
`not_planned`.

## Running these

**Which to pick.** Scenario 10 proves the pipeline in about a minute with no spec
work; scenario 1 is the simplest demo that is a real defect; scenario 3 proves the
judgment; scenario 7 proves the loop notices its own fix failed.

For a single demo to an audience: **10 then 1 then 3** — the loop exists, it finds
a genuine defect, and it decides rather than pattern-matches.

As regression tests: scenario 3 after any change to the `coding-agent-handoff` skill, because
it is the one an over-eager decline would drop; scenario 7 after any change to
dedupe or recurrence handling.

**How confident each one is.** **Scenario 4 is the one to trust**: observed end to
end on 2026-08-27 **from the spec alone**, no hand-committed regression — alert, RCA,
`classification=code_level`, `adopted=True`, coding agent dispatched within a minute.
It is also the cheapest to re-arm, because its fault is an operator switch rather than
a coincidence. **Scenario 1 is observed end to end** too — trigger,
alert, RCA, issue, agent PR, platform merge, build, deployed fix, and the log going
quiet again, all timestamped under that scenario. It got there through a
hand-committed regression, not through the generator omitting the branch: **three
separate spec-driven attempts never fired**, each ending in an explicit failure
branch logged at WARN or INFO, because AE writes the OpenAPI contract before the code
and a documented 5xx forces that branch. The wording of those bullets matters, and it
is not sufficient on its own. The framework-default
finding (an unrouted path) is the other one seen end to end — three projects, three
issues — and it now fires uninvited often enough to be a nuisance rather than a
demo. Scenario 5 is measured to the point of the fault (no ceiling, cost growing
linearly) but not through to an alert. **Scenario 3 is half-observed**: the
generator does write the unbounded `while true` loop with a `printError` per attempt
when the spec asks for it — verified in the generated source — but the run never
fired, for three reasons its own note records. **Scenario 9 is unobserved** and its old
*"Reliability: high"* was wrong, but its current requirement set is sound: unlike
scenario 4 a no-failure-response contract is not sufficient on its own here, because an
empty list has a legal success answer — so it also needs the *"no separate path, no
separate result"* clause, and both have to land. Run
[Before you demo](#before-you-demo-prove-the-line-matches) on anything unobserved, and
prefer 4 — it is the only one that has fired from the spec alone.

**Demo cadence is throttled, twice.** `ALERT_SUPPRESSION_WINDOW` (**1h** — what `setup-observability.sh` patches onto
`observer-config`) dedups per
rule and component, and the logs-adapter hardcodes a **60-minute** webhook
throttle — so a repeat of the *same* error will not re-fire the pipeline within
the hour. While iterating, `POST /analyze` directly against `ai-rca-agent` with
the alert scope and bypass both.

**When a demo must not fail.** Let AE build the version correctly, then commit a
regression by hand — and make it one that removes the *handling*, not one that
changes a log level: put back `check` on a data-binding client, delete the backoff,
drop the guard. For the unreliable-backend project that is

```ballerina
resource function post attempts() returns AttemptResultOk|error {
    AttemptResult result = check callService2Attempt();   // 5xx → error value → propagates
    log:printInfo("attempt request handled", outcome = "success");
    return <AttemptResultOk>{body: result};
}
```

This is the route scenario 1's measured timeline was produced by, and it cannot
fail to produce both a defect and a line the rule matches. Keep the
`AttemptResultOk` return type — see the 201 note under scenario 1. One caveat: if
the PRD still forbids the remedy — a passthrough product decision, an out-of-scope
line about not hiding the failure — the handoff can still decline on spec grounds.
The regression makes the alert fire; it does not make the spec correct. Where the
spec has an acceptance criterion on *logging the outcome* (`AC-004-a`-style), the
regression breaks that criterion, which is the strongest position to be in: the fix
is then spec-mandated and cannot be declined as out of scope.

**Pushing the regression does not deploy it, and this is easy to lose an hour to.**
Components are created `AutoBuild=false`; AEP subscribes to GitHub's `push` event
but registers no handler, so the delivery is accepted and dropped
(`webhook: no handler … event=push`). `scripts/project-rebuild.sh <project>
<component>` builds from the branch head — and stops there. Promotion to a
`ComponentRelease` happens only in the Temporal delivery activity
(`internal/delivery/run/activities.go`, `Deploy(..., in.CommitSHA)`); every other
caller passes an empty commit, which is the CONVERGE case and deliberately promotes
nothing. The two builds are told apart by their names: the merged-PR fan-out pins a
SHA (`…-service1-e9f39b664ec7-…`) and deploys itself, while a manual build is
`…-service1-<hash>-<epoch>` and leaves the Workload updated but unreferenced.

So a hand-pushed commit has to be promoted by hand — the same two writes the
platform would do:

```bash
# 1. cut a release from the Workload the build just updated
kubectl -n default get componentrelease <current-release> -o json \
  | jq 'del(.status,.metadata.uid,.metadata.resourceVersion,.metadata.creationTimestamp,.metadata.generation)
        | .metadata.name="<project>-<component>-<sha12>-manual"
        | .spec.workload.container.image="<registry>/<image>:v1-<sha8>"' \
  | kubectl apply -f -

# 2. point the binding at it
kubectl -n default patch releasebinding <component>-development --type=merge \
  -p '{"spec":{"releaseName":"<project>-<component>-<sha12>-manual"}}'
```

Reversible by patching `releaseName` back; a later converge will not undo it,
because `deployOne` preserves the pinned release when the commit is empty. Do NOT
reach for a spec publish to force a proper delivery run instead — that regenerates
the component from the spec and erases the regression.

**What to expect in the agent log** when the handoff fires:

```
Running handoff agent
Created agent with 3 tools: ['ae_search_related_issues', 'ae_create_issue', 'load_skill']
Handoff completed: classification=code-level, issue=…, adopted=True
```

`adopted=True` means the issue is in the deployed version's milestone as agent
work and a coding run has it. `adopted=False` means the issue was filed but
nothing will work it — the line names why, usually a project with no built
version to adopt an incident into. `classification=none` means the handoff
decided no code change was needed, which for a scenario on this page means the
spec and the defect are not in conflict — re-read the rule at the top.

---

## Outcomes a demo can legitimately reach

Not every green run ends in a merged PR, and three of the other endings are
shipped behaviour rather than failure. Recognise them before debugging them.

- **`classification=none`, no issue** — the handoff ruled a code change out. For a
  scenario on this page that means the spec and the defect are not in conflict:
  re-read the rule at the top. Note the platform no longer lets this end the
  incident silently — `createreport` files and dispatches the issue itself when the
  report still carries an unaddressed code-level action (a `_(suggested)_` one), and
  logs `rca report: escalated …`. So a demo may show an issue appearing even though
  the handoff declined.
- **Issue closed as `not_planned`** — the coding agent examined the work and
  concluded no code change is possible, usually because the spec forbids the only
  remedy. The cycle ends cleanly (`cycleNoWork`, ADR-0023), the run settles
  `succeeded` with no pull request, and the verdict suppresses re-filing on that
  dedupe key. This is the correct ending for a scenario that broke the rule at the
  top of this page.
- **Merged, issue left OPEN** — the fix shipped without a high-confidence
  declaration, so its issues stay open as an unverified fix (ADR-0022). Add
  `Confidence: high` to close them on merge.
