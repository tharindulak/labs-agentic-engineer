/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Alert, Box, Button, CircularProgress, PageContent } from "@wso2/oxygen-ui";
import { Outlet } from "@tanstack/react-router";
import { useProject, useProjectStatus } from "../api/queries";

// The project shell (#185, #216): each project sub-route (Overview, Builds,
// Deployments, Issues) renders its own PageHeader (Task 5) rather than
// sharing one rendered here, so this layout is left with the guards every
// sub-route needs regardless of its own content — the loading/error state
// while the project itself resolves, and the repo-error banner — plus the
// PageContent wrapper and the Outlet.
export function ProjectLayout({ projectName }: { projectName: string }) {
  const project = useProject(projectName);
  const status = useProjectStatus(projectName);

  if (project.isPending) {
    return (
      <PageContent>
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading project" />
        </Box>
      </PageContent>
    );
  }

  if (project.isError) {
    return (
      <PageContent>
        <Alert
          severity="error"
          action={<Button onClick={() => void project.refetch()}>Retry</Button>}
        >
          Failed to load project
          {project.error instanceof Error && project.error.message
            ? `: ${project.error.message}`
            : ""}
        </Alert>
      </PageContent>
    );
  }

  return (
    <PageContent>
      {status.data?.phase === "repo-error" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Repository problem
          {status.data.repoErrorMessage
            ? `: ${status.data.repoErrorMessage}`
            : ""}
        </Alert>
      )}

      <Outlet />
    </PageContent>
  );
}
