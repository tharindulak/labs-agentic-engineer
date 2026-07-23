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
import { parseSseStream } from "@aep/agent-stream";
import type { components } from "../../../generated/aep-api";
import { useProjectActivity } from "../api/queries";
import { openActivityStream } from "../api/stream";

type ActivityEvent = components["schemas"]["ActivityEvent"];

const RECONNECT_DELAY_MS = 3_000;

/**
 * Seeds from the initial activity page (useProjectActivity), then tails the
 * SSE stream for live events. Reconnect-safe: the server replays recent
 * events on each attach and this hook dedups by id, so a dropped connection
 * just re-emits already-seen events, which are silently skipped.
 */
export function useActivityFeed(projectName: string): {
  events: ActivityEvent[];
  isPending: boolean;
  isError: boolean;
} {
  const initial = useProjectActivity(projectName);
  const [live, setLive] = useState<ActivityEvent[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    seen.current = new Set();
    setLive([]);
    const controller = new AbortController();
    let disposed = false;

    const consume = async (): Promise<"done" | "eof"> => {
      const body = await openActivityStream(projectName, controller.signal);
      const frames = parseSseStream(body);
      while (true) {
        const next = await frames.next();
        if (next.done) return next.value;
        const ev = next.value as unknown as ActivityEvent;
        if (!ev?.id || seen.current.has(ev.id)) continue;
        seen.current.add(ev.id);
        setLive((prev) => [ev, ...prev]);
      }
    };

    const run = async () => {
      while (!disposed) {
        try {
          await consume();
        } catch {
          if (disposed) return;
        }
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    };
    void run();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [projectName]);

  const base = initial.data ?? [];
  const baseIds = new Set(base.map((e) => e.id));
  const merged = [...live.filter((e) => !baseIds.has(e.id)), ...base];

  return { events: merged, isPending: initial.isPending, isError: initial.isError };
}
