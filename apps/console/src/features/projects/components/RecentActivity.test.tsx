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

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentActivity } from "./RecentActivity";

vi.mock("../../../auth/SessionContext", () => ({
  useSession: () => ({ user: { email: "me@x.com", name: "Me" } }),
}));

let mockEvents: unknown[] = [];
vi.mock("../../activity/hooks/useActivityFeed", () => ({
  useActivityFeed: () => ({ events: mockEvents, isPending: false, isError: false }),
}));

function specEvent(id: number) {
  return {
    id: String(id),
    type: "spec_updated",
    actorKind: "agent",
    actorName: `Agent ${id}`,
    occurredAt: new Date().toISOString(),
  };
}

describe("RecentActivity", () => {
  it("shows the empty state with no events", () => {
    mockEvents = [];
    render(<RecentActivity projectName="p" />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders a deployed line", () => {
    mockEvents = [
      {
        id: "1",
        type: "task_deployed",
        actorKind: "agent",
        actorName: "Build agent",
        issue: 10,
        title: "Catalog",
        occurredAt: new Date().toISOString(),
      },
    ];
    render(<RecentActivity projectName="p" />);
    expect(screen.getByText(/deployed #10 Catalog/)).toBeInTheDocument();
  });

  it("caps the overview at the newest six events", () => {
    mockEvents = Array.from({ length: 10 }, (_, i) => specEvent(i + 1));
    render(<RecentActivity projectName="p" />);
    expect(screen.getByText("Agent 1")).toBeInTheDocument();
    expect(screen.getByText("Agent 6")).toBeInTheDocument();
    expect(screen.queryByText("Agent 7")).not.toBeInTheDocument();
  });
});
