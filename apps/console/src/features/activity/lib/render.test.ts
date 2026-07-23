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

import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/aep-api";
import { activityLine } from "./render";

type ActivityEvent = components["schemas"]["ActivityEvent"];

const VIEWER_EMAIL = "viewer@example.com";

describe("activityLine", () => {
  it("renders a task_deployed event", () => {
    const event: ActivityEvent = {
      id: "evt-1",
      type: "task_deployed",
      actorKind: "agent",
      actorName: "Build agent",
      issue: 10,
      title: "Catalog",
      occurredAt: "2026-07-17T10:00:00Z",
    };

    const line = activityLine(event, VIEWER_EMAIL);

    expect(line.actor).toBe("Build agent");
    expect(line.text).toBe("deployed #10 Catalog");
    expect(line.tone).toBe("success");
  });

  it("renders 'You' when the actor is the signed-in viewer", () => {
    const event: ActivityEvent = {
      id: "evt-2",
      type: "spec_published",
      actorKind: "user",
      actorId: VIEWER_EMAIL,
      actorName: "Viewer Name",
      tag: "v1-1",
      occurredAt: "2026-07-17T10:05:00Z",
    };

    const line = activityLine(event, VIEWER_EMAIL);

    expect(line.actor).toBe("You");
    expect(line.text).toBe("published spec v1-1 and started build");
    expect(line.tone).toBe("neutral");
  });

  it("renders a spec_updated event with the instruction subject", () => {
    const event: ActivityEvent = {
      id: "evt-4",
      type: "spec_updated",
      actorKind: "user",
      actorId: VIEWER_EMAIL,
      actorName: "Viewer Name",
      title: "add a gym tracker web app",
      occurredAt: "2026-07-17T10:02:00Z",
    };

    const line = activityLine(event, VIEWER_EMAIL);

    expect(line.actor).toBe("You");
    expect(line.text).toBe("updated the spec — add a gym tracker web app");
    expect(line.tone).toBe("neutral");
  });

  it("renders a spec_updated event without a title", () => {
    const event: ActivityEvent = {
      id: "evt-5",
      type: "spec_updated",
      actorKind: "agent",
      actorName: "Spec agent",
      occurredAt: "2026-07-17T10:03:00Z",
    };

    const line = activityLine(event, VIEWER_EMAIL);

    expect(line.actor).toBe("Spec agent");
    expect(line.text).toBe("updated the spec");
  });

  it("renders the teammate's name when the actor is a different user", () => {
    const event: ActivityEvent = {
      id: "evt-3",
      type: "spec_published",
      actorKind: "user",
      actorId: "teammate@example.com",
      actorName: "Teammate Name",
      tag: "v1-1",
      occurredAt: "2026-07-17T10:10:00Z",
    };

    const line = activityLine(event, VIEWER_EMAIL);

    expect(line.actor).toBe("Teammate Name");
    expect(line.text).toBe("published spec v1-1 and started build");
  });
});
