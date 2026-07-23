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

import { useCallback } from "react";
import type { components } from "../../generated/aep-api";
import { chatKeyFor, setPendingSeed } from "./chatStore.js";
import {
  buildDependencyResolutionMessage,
  type DependencyResolutionIntent,
} from "../projects/lib/dependencyResolutionMessage.js";

type Dependency = components["schemas"]["Dependency"];

/**
 * The "Resolve via chat" seam for Task 9 (#252): returns a callback that
 * seeds the project's EXISTING collab conversation with a message asking the
 * architect to act on ONE dependency — `intent` distinguishes "resolve" (a
 * non-resolved dependency, #252 Task 9/10) from "reconsider" (an already
 * resolved dependency the user wants to revisit, #252 Task 17) — and (via the
 * same pendingSeed slot AppLayout watches) opens the chat panel and
 * auto-sends it — no new conversation, no scope badge, no new useCase. Task 9
 * wires this to the on-card / drawer / build-drawer button's onClick; this
 * task only builds the plumbing.
 *
 * `org` must be the SAME fallback convention AppLayout uses for the chat
 * panel (`orgHandle ?? "default"`) — NOT SpecView's collab-room fallback
 * (`orgHandle ?? "acme"`), which is an unrelated convention for a different
 * purpose (collab mock BFF default org). A mismatched fallback here would
 * seed a chat key nothing is listening on.
 */
export function useResolveDependencyViaChat(
  org: string,
  projectName: string,
): (
  componentName: string,
  dep: Dependency,
  intent: DependencyResolutionIntent,
) => void {
  return useCallback(
    (componentName: string, dep: Dependency, intent: DependencyResolutionIntent) => {
      const message = buildDependencyResolutionMessage(componentName, dep, intent);
      setPendingSeed(chatKeyFor(org, projectName), message);
    },
    [org, projectName],
  );
}
