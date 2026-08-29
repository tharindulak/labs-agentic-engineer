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

import { http, HttpResponse } from "msw";
import { activityFeed } from "../fixtures/activity";

// The overview's activity feed (#239): a static replay for the initial read,
// plus an SSE tail that stays idle. Mock mode has no live event source, so
// the stream sends the done sentinel and closes immediately — useActivityFeed
// treats that as a clean end and reconnects (matching prod's reconnect
// behaviour on a dropped connection), but since the seeded read already has
// every event, no visible gap results.
// Scenario switch (api-guidelines: error and empty scenarios; ADR-0004):
//   localStorage.setItem('aep:mock:activity', 'empty' | 'some' | 'error')
// Unset, the feed follows the project scenario: a 'fresh' project has done
// nothing yet, so its activity is empty without a second devtools key.
type ActivityScenario = "empty" | "some" | "error";

function activityScenario(): ActivityScenario {
  const chosen = localStorage.getItem("aep:mock:activity");
  if (chosen === "empty" || chosen === "some" || chosen === "error") {
    return chosen;
  }
  return localStorage.getItem("aep:mock:project") === "fresh"
    ? "empty"
    : "some";
}

export const activityHandlers = [
  http.get("*/api/v1/projects/:projectName/activity", () => {
    const s = activityScenario();
    if (s === "error") {
      return HttpResponse.json(
        { code: "internal_error", message: "Mock error scenario for activity" },
        { status: 500 },
      );
    }
    return HttpResponse.json(s === "empty" ? { items: [] } : activityFeed);
  }),

  http.get("*/api/v1/projects/:projectName/activity/stream", () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }),
];
