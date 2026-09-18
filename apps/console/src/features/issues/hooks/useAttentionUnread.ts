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

import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { components } from "../../../generated/aep-api";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { issueKeys } from "../api/keys";
import type { IssueInfo, IssueAttentionReason } from "../api/queries";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];

const ATTENTION_SEEN_KEY = "aep:issues:attentionSeen";

export type AttentionItem = {
  id: string;
  projectName: string;
  issueNumber: number;
  title: string;
  reason: IssueAttentionReason;
};

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ATTENTION_SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(ATTENTION_SEEN_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — unread state just won't persist across reloads.
  }
}

export function attentionItemId(projectName: string, issueNumber: number, reason: IssueAttentionReason): string {
  return `${projectName}#${issueNumber}:${reason}`;
}

export function collectAttentionItems(reports: RcaAgentReport[], issuesByProject: Map<string, IssueInfo[]>): AttentionItem[] {
  const out: AttentionItem[] = [];
  const seen = new Set<string>();
  for (const report of reports) {
    if (!report.project || !report.issueNumber) continue;
    const issue = (issuesByProject.get(report.project) ?? []).find((candidate) => candidate.Number === report.issueNumber);
    if (!issue?.attentionReason) continue;
    const id = attentionItemId(report.project, issue.Number, issue.attentionReason);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      projectName: report.project,
      issueNumber: issue.Number,
      title: issue.Title,
      reason: issue.attentionReason,
    });
  }
  return out;
}

export function countUnreadAttention(items: AttentionItem[], seenIds: string[]): number {
  const seen = new Set(seenIds);
  return items.filter((item) => !seen.has(item.id)).length;
}

export function useAttentionUnread(reports: RcaAgentReport[]) {
  const [seenIds, setSeenIds] = useState<string[]>(readSeen);
  const projectNames = useMemo(
    () => [...new Set(reports.map((report) => report.project).filter(Boolean))],
    [reports],
  );

  const queries = useQueries({
    queries: projectNames.map((projectName) => ({
      queryKey: issueKeys.list(projectName, undefined),
      queryFn: async () => {
        const { data, error } = await client.GET("/projects/{projectName}/issues", {
          params: { path: { projectName } },
        });
        if (error) {
          throw new Error(apiErrorMessage(error, "Failed to load issues"));
        }
        return (data ?? []) as IssueInfo[];
      },
      staleTime: 30_000,
    })),
  });

  const issuesByProject = useMemo(() => {
    const byProject = new Map<string, IssueInfo[]>();
    projectNames.forEach((projectName, index) => {
      byProject.set(projectName, queries[index]?.data ?? []);
    });
    return byProject;
  }, [projectNames, queries]);

  const items = useMemo(() => collectAttentionItems(reports, issuesByProject), [reports, issuesByProject]);
  const unreadCount = useMemo(() => countUnreadAttention(items, seenIds), [items, seenIds]);

  const markAllSeen = useCallback(() => {
    const next = [...new Set([...seenIds, ...items.map((item) => item.id)])];
    setSeenIds(next);
    writeSeen(next);
  }, [items, seenIds]);

  return { items, unreadCount, markAllSeen };
}
