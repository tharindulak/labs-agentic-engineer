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

import type { components } from "../../generated/aep-api";

type ActivityFeed = components["schemas"]["ActivityFeed"];

// A small, static replay for the overview's activity feed (#239) — newest
// event first, matching how the real BFF orders GET .../activity. The SSE
// tail (handlers/activity.ts) starts empty; this seed is what mock mode
// renders.
export const activityFeed: ActivityFeed = {
  items: [
    {
      id: "evt-5",
      type: "task_deployed",
      actorKind: "agent",
      actorName: "Build agent",
      issue: 10,
      title: "Product catalog CRUD endpoints",
      component: "catalog-api",
      occurredAt: "2026-07-17T09:56:00Z",
    },
    {
      id: "evt-4",
      type: "task_failed",
      actorKind: "agent",
      actorName: "Build agent",
      issue: 11,
      title: "Orders service payment integration",
      component: "orders-api",
      occurredAt: "2026-07-17T09:38:00Z",
    },
    {
      id: "evt-3",
      type: "task_started",
      actorKind: "agent",
      actorName: "Build agent",
      issue: 9,
      title: "Scaffold storefront app shell",
      component: "storefront",
      occurredAt: "2026-07-17T09:20:00Z",
    },
    {
      id: "evt-2",
      type: "plan_derived",
      actorKind: "agent",
      actorName: "Plan agent",
      occurredAt: "2026-07-17T09:05:00Z",
    },
    {
      id: "evt-1",
      type: "spec_published",
      actorKind: "user",
      // Matches the mock dev identity (auth/mockSession.ts) so the overview
      // renders "You" for this line in mock mode, same as it would for the
      // real signed-in viewer.
      actorId: "developer@example.com",
      actorName: "Developer",
      tag: "v1",
      occurredAt: "2026-07-17T09:00:00Z",
    },
  ],
};
