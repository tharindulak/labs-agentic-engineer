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
 * The streaming chat screen (docs/design/playground.md §7): free-chat turns in
 * the project's single `general` conversation — exactly the console's chat
 * panel. Follow-ups are history-aware; hand-edits between turns are picked up
 * via D20 (`filesChangedExternally`).
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chatTurn, type PhaseOptions } from "../commands.js";
import type { PlaygroundSession } from "../engine/session.js";

/** The per-project chat loop. Returns when the user goes back to the menu or quits. */
export async function chatLoop(session: PlaygroundSession, opts: PhaseOptions): Promise<"menu" | "quit"> {
  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    output.write("\n");
    process.exit(130); // Ctrl-C: hard exit (the in-process server dies with us)
  });
  output.write("  chat — /menu to go back, /quit to exit\n");
  try {
    for (;;) {
      let raw: string;
      try {
        raw = await rl.question(`\n${session.state.slug} ❯ `);
      } catch {
        return "quit"; // stdin closed (Ctrl-D)
      }
      const line = raw.trim();
      if (line === "") continue;
      if (line === "/quit") return "quit";
      if (line === "/menu" || line === "/threads") return "menu";
      if (line === "/help") {
        output.write("  commands: /menu, /quit, /help\n");
        continue;
      }
      const outcome = await chatTurn(session, line, opts);
      if (!outcome.ok) output.write(`\n[turn failed] ${outcome.detail ?? "unknown error"}\n`);
    }
  } finally {
    rl.close();
  }
}
