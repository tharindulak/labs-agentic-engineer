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

// Server history → display log for rehydrate (#130 multi-user threads):
// user/assistant text only — tool/system parts don't reconstruct into cards,
// the shared spec doc already reflects them. A user message carries `author`
// when the server payload has one, so a teammate's turn is distinguishable
// from the signed-in user's once rehydrated (pure mapping — kept out of
// useAgentChat.ts so it's independently testable).

import type { ChatMessage } from "./chatStore.js";
import type { ConversationMessage } from "./api/turns.js";

export function projectableHistory(history: ConversationMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    const text = contentText(m.content);
    if (!text) continue;
    if (m.role === "user") {
      out.push({
        id: "",
        role: "user",
        content: text,
        status: "completed",
        ...(m.author ? { author: m.author } : {}),
      });
    } else if (m.role === "assistant") {
      out.push({ id: "", role: "assistant", turnId: "history", content: text });
    }
  }
  return out;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "object" && p !== null && (p as { type?: string }).type === "text"
          ? ((p as { text?: string }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}
