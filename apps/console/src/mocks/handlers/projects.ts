import { http, HttpResponse } from "msw";
import type { components } from "../../generated/aep-api";

type ApiError = components["schemas"]["Error"];
import {
  deleteProjectError,
  duplicateProjectError,
  emptyProjects,
  projectsError,
  PROJECTS_PAGE_SIZE,
  seedProjects,
  type ProjectsScenario,
} from "../fixtures/projects";

type Project = components["schemas"]["Project"];
type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];

function scenario(): ProjectsScenario {
  return (
    (localStorage.getItem("aep:mock:projects") as ProjectsScenario | null) ??
    "empty"
  );
}

// Projects created/deleted through the UI, persisted to localStorage so the
// create and delete flows survive a page reload (a Vite HMR update, or the
// user refreshing) instead of vanishing with module state — otherwise a
// freshly created project's routes (overview, builds, …) 404 after any reload.
const CREATED_KEY = "aep:mock:createdProjects";
const DELETED_KEY = "aep:mock:deletedProjects";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Layered on top of the scenario's seed so the create flow behaves statefully.
const createdProjects: Project[] = loadJson<Project[]>(CREATED_KEY, []);

// Names deleted through the UI — masks seed AND created entries (#107).
const deletedProjects = new Set<string>(loadJson<string[]>(DELETED_KEY, []));

function persistCreated(): void {
  try {
    localStorage.setItem(CREATED_KEY, JSON.stringify(createdProjects));
  } catch {
    /* quota — non-fatal in mock mode */
  }
}

function persistDeleted(): void {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedProjects]));
  } catch {
    /* quota — non-fatal in mock mode */
  }
}

function currentProjects(): Project[] {
  const seed = scenario() === "some" ? seedProjects : [];
  return [...seed, ...createdProjects].filter(
    (p) => !deletedProjects.has(p.name),
  );
}

export const projectsHandlers = [
  // Wildcard prefix: matches whatever runtime API base URL sits in front of
  // /api/v1.
  http.get("*/api/v1/projects", ({ request }) => {
    if (scenario() === "error") {
      return HttpResponse.json(projectsError, {
        status: 500,
      });
    }
    const params = new URL(request.url).searchParams;
    const search = params.get("search")?.trim();
    const matches = currentProjects().filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name?.toLowerCase().includes(q) ||
        p.displayName?.toLowerCase().includes(q)
      );
    });
    if (matches.length === 0 && !search) {
      return HttpResponse.json(emptyProjects);
    }
    // The cursor is opaque to the client; the mock's is a plain offset.
    const offset = Number(params.get("cursor") ?? 0) || 0;
    const limit = Number(params.get("limit")) || PROJECTS_PAGE_SIZE;
    const items = matches.slice(offset, offset + limit);
    const next = offset + limit;
    return HttpResponse.json({
      items,
      ...(next < matches.length && { nextCursor: String(next) }),
    });
  }),

  http.post("*/api/v1/projects", async ({ request }) => {
    const body = (await request.json()) as CreateProjectRequest;
    if (currentProjects().some((p) => p.name === body.name)) {
      return HttpResponse.json(duplicateProjectError, {
        status: 409,
      });
    }
    // The build prompt is the project's description when none is given
    // explicitly — it's what the card and overview show, so a project created
    // from the "what do you want to build" flow isn't left blank.
    const description = body.description ?? body.prompt;
    const project: Project = {
      name: body.name,
      displayName: body.displayName ?? body.name,
      ...(description !== undefined && { description }),
      status: "active",
      createdAt: new Date().toISOString(),
    };
    createdProjects.push(project);
    persistCreated();
    return HttpResponse.json(project, { status: 201 });
  }),

  http.get("*/api/v1/projects/:projectName", ({ params }) => {
    const project = currentProjects().find(
      (p) => p.name === params.projectName,
    );
    if (!project) {
      return HttpResponse.json(
        {
          code: "not_found",
          message: `Project ${String(params.projectName)} not found`,
        } satisfies ApiError,
        { status: 404 },
      );
    }
    return HttpResponse.json(project);
  }),

  // delete-project (#107). Error state via
  // localStorage.setItem('aep:mock:projects:delete', 'error').
  http.delete("*/api/v1/projects/:projectName", ({ params }) => {
    if (localStorage.getItem("aep:mock:projects:delete") === "error") {
      return HttpResponse.json(deleteProjectError, {
        status: 500,
      });
    }
    const name = String(params.projectName);
    if (!currentProjects().some((p) => p.name === name)) {
      return HttpResponse.json(
        {
          code: "not_found",
          message: `Project ${name} not found`,
        } satisfies ApiError,
        { status: 404 },
      );
    }
    deletedProjects.add(name);
    persistDeleted();
    return new HttpResponse(null, { status: 204 });
  }),

  // GitHub connection status (for the create flow's repo-URL preview) now
  // comes from GET /config — mocked in mocks/handlers/settings.ts.
];
