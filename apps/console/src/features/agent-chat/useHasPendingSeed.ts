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

import { useCallback, useSyncExternalStore } from "react";
import { chatKeyFor, peekPendingSeed, subscribeSeed } from "./chatStore.js";

/**
 * True whenever the project's chat has a seeded message waiting to be sent
 * (the "Resolve via chat" action, #252 Task 5). AppLayout uses this to open
 * the chat panel the same way it already does for the `?generate=` signal
 * (see AppLayout.tsx) — the seed is set from a subtree (dep card / drawer /
 * build drawer) that doesn't share the panel's open/close state, so the
 * panel has to be opened reactively from this store signal rather than a
 * prop the click handler could set directly.
 */
export function useHasPendingSeed(
  org: string,
  projectName: string | undefined,
): boolean {
  const chatKey = projectName ? chatKeyFor(org, projectName) : null;
  return useSyncExternalStore(
    useCallback(
      (fn: () => void) => (chatKey ? subscribeSeed(chatKey, fn) : () => {}),
      [chatKey],
    ),
    () => (chatKey ? peekPendingSeed(chatKey) !== null : false),
  );
}
