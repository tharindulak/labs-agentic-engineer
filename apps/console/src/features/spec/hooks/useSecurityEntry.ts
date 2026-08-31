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

/**
 * Everything the Security rail entry needs, gathered in one place.
 *
 * It lives here rather than inline in `SpecView` because the two are edited for
 * different reasons: `SpecView` owns the rail and the pane ladder, and this owns
 * how the security design is read. Threading the document read and live
 * directory query through the page component made one file change for two
 * unrelated reasons.
 *
 * One document (`security.json`) from the collab room (committed fallback when
 * the room has not delivered it yet). Live directory chips come from the
 * platform as the last Build left them. Spec does not edit the document —
 * account reveal/rotate/delete stay on Deploy (ticket 15).
 */

import { SECURITY_JSON_PATH } from "../api/designTree";
import type { SpecFileEntry } from "../api/mapping";
import { useSpecFileContent } from "../api/queries";
import {
  useProjectRoles,
  type ProjectRolesLiveState,
} from "../api/roles";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useYTextString } from "../collab/useYTextString";

export interface SecurityEntry {
  /** The security document — live from the room, else the committed copy. */
  securityJson: string | null;
  /** The live directory state, undefined while it loads. */
  live: ProjectRolesLiveState | undefined;
  /**
   * True only while the committed `security.json` fallback is in flight.
   * A disabled query still reports `isPending` in react-query, so this is
   * gated on the fallback actually being used — same rule as Architecture
   * and Wireframes. Live directory chips (`GET …/roles`) fill in after paint
   * and do not block the page.
   */
  isPending: boolean;
  /** True only when that same committed fallback failed. */
  isError: boolean;
}

export function useSecurityEntry({
  projectName,
  active,
  files,
  collab,
  agentInRoom,
}: {
  projectName: string;
  /** False when the Security entry is not the current selection — every read
   *  below is then skipped rather than fetched and thrown away. */
  active: boolean;
  files: SpecFileEntry[];
  collab: CollabSpec;
  agentInRoom: boolean;
}): SecurityEntry {
  const securityLiveText = useYTextString(
    active ? collab.getFileText(SECURITY_JSON_PATH) : null,
  );
  // The committed copy is the solo fallback only. An agent in the room also
  // suppresses it: the doc WILL deliver the file, and probing git for a
  // not-yet-committed path just sprays 404s.
  const restFallback =
    active && securityLiveText === null && !agentInRoom
      ? (files.find((f) => f.path === SECURITY_JSON_PATH) ?? null)
      : null;
  const securityCommitted = useSpecFileContent(projectName, restFallback);

  const live = useProjectRoles(projectName, active);

  return {
    securityJson: securityLiveText ?? securityCommitted.data?.content ?? null,
    live: live.data,
    isPending: restFallback !== null && securityCommitted.isPending,
    isError: restFallback !== null && securityCommitted.isError,
  };
}
