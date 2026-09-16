import { http, HttpResponse } from "msw";
import {
  emptyIssues,
  issuesError,
  seedIssuesByProject,
  type IssuesScenario,
} from "../fixtures/issues";

function scenario(): IssuesScenario {
  return (
    (localStorage.getItem("aep:mock:issues") as IssuesScenario | null) ?? "some"
  );
}

export const issuesHandlers = [
  http.get("*/api/v1/projects/:projectName/issues", ({ params, request }) => {
    if (scenario() === "error") {
      return HttpResponse.json(issuesError, { status: 500 });
    }
    if (scenario() === "empty") {
      return HttpResponse.json(emptyIssues);
    }
    const all = seedIssuesByProject[String(params.projectName)] ?? [];
    const labels = (new URL(request.url).searchParams.get("labels") ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    const filtered =
      labels.length === 0
        ? all
        : all.filter((issue) => labels.every((l) => (issue.Labels ?? []).includes(l)));
    return HttpResponse.json(filtered);
  }),
];
