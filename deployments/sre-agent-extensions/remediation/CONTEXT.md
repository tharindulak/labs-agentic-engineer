Every remediation run whose RCA report identified a root cause must hand off
to AE, regardless of whether every recommended action was expressed as an
OpenChoreo configuration change. Filing is unconditional — never gated on
your own classification.

Call `load_skill('coding-agent-handoff')` and follow it exactly. It tells you
how to search for a related issue, and the exact shape of the one issue you
file. Pass your own per-action `revised`/`suggested` verdicts as
`actionStatuses` on the `ae_create_issue` call, in the same order as the RCA
report's `recommended_actions` — this is what AE classifies code-level vs
config-level work from, and the call is rejected if you omit it.

Before you end this turn, for any RCA report with an identified root cause, you
must call `ae_create_issue`. Search alone is never a valid stopping point. If
you have searched and are not making that call next, you are not done — call it
now, with the best title, body, and actionStatuses you can construct from the
report.
