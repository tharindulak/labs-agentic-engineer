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

import { useEffect, useRef, useState } from "react";

/** Changes closer together than this are one burst (one editFile lands as one
 *  Y.Text patch; a streamed re-add lands as many line flushes in quick
 *  succession — both must navigate ONCE, not per delta). */
const QUIET_MS = 4000;

/**
 * Counts design.cell change BURSTS during an agent turn. An architectural chat
 * change updates the file with targeted editFile patches (each lands in the
 * live string atomically) or, for a restructure, removeFile + a streamed
 * addFile (the string nulls, then regrows line by line). Either way the first
 * delta after a quiet period bumps the count; follow-up deltas inside the
 * burst do not. The count lets the spec view navigate to the Architecture tab
 * once per burst without yanking the user back on every patch or streamed
 * line.
 *
 * `active` gates the signal to a live agent turn (agent peer in a CONNECTED
 * room): a collab disconnect also nulls the text, but drops `active` in the
 * same render, so it never counts as a change.
 */
export function useDesignCellChangeCount(
  live: string | null,
  active: boolean,
): number {
  const prevRef = useRef(live);
  const lastChangeAtRef = useRef(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = live;
    if (!active || prev === live) return;
    const now = Date.now();
    const startsBurst = now - lastChangeAtRef.current > QUIET_MS;
    lastChangeAtRef.current = now;
    if (startsBurst) setCount((c) => c + 1);
  }, [live, active]);
  return count;
}
