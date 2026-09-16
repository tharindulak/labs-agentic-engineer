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

import { Alert, Box, Button, CircularProgress, ListingTable, Typography } from "@wso2/oxygen-ui";
import { EmptyState } from "../../../components/EmptyState";
import { StatusChip } from "../../../components/StatusChip";
import { useProjectIssues } from "../api/queries";
import { attentionReasonLabel, attentionReasonTone } from "../attention";

// Issues carry no console-side detail page — GitHub already is the durable
// record of an issue's history, so a row opens it there.
function openIssue(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function IssuesList({ projectName }: { projectName: string }) {
  const { data: issues = [], isPending, isError, error, refetch } = useProjectIssues(projectName);

  if (isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading issues" />
      </Box>
    );
  }

  if (isError) {
    return (
      <Alert severity="error" action={<Button onClick={() => void refetch()}>Retry</Button>}>
        Failed to load issues
        {error instanceof Error && error.message ? `: ${error.message}` : ""}
      </Alert>
    );
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        title="No issues yet"
        description="Issues the SRE agent raises against this project will land here."
      />
    );
  }

  return (
    <ListingTable.Container sx={{ width: "100%" }} disablePaper>
      <ListingTable variant="card" density="standard">
        <ListingTable.Body>
          {issues.map((issue) => (
            <ListingTable.Row
              key={issue.Number}
              variant="card"
              hover
              clickable
              onClick={() => openIssue(issue.URL)}
            >
              <ListingTable.Cell>
                <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={2}>
                  <Box minWidth={0} flexGrow={1}>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {issue.Title}
                      </Typography>
                      <StatusChip
                        label={issue.State === "closed" ? "Closed" : "Open"}
                        tone={issue.State === "closed" ? "neutral" : "info"}
                        variant="outlined"
                      />
                      {issue.AttentionReason && (
                        <StatusChip
                          label={attentionReasonLabel(issue.AttentionReason)}
                          tone={attentionReasonTone(issue.AttentionReason)}
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </Box>
                </Box>
              </ListingTable.Cell>
            </ListingTable.Row>
          ))}
        </ListingTable.Body>
      </ListingTable>
    </ListingTable.Container>
  );
}
