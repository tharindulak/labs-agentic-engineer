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

// The create-project prompt, persisted client-side (#150). The BE receives
// `prompt` on create but never hands it back (the Project read schema has no
// prompt field), so the console keeps its own copy to seed the first
// requirements-generation turn from the Spec card's "Generate spec" CTA.
// Keyed by (org, project); org matches what AppLayout passes the chat panel
// (`orgHandle ?? "default"`), so the writer (ProjectCreate) and the reader
// (AgentChatPanel) resolve the same key.

function key(org: string, project: string): string {
  return `aep.createPrompt.${org}.${project}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // SSR / privacy-mode denial — degrade to "no stored prompt"
  }
}

export function saveCreatePrompt(
  org: string,
  project: string,
  prompt: string,
): void {
  const text = prompt.trim();
  if (!text) return;
  safeLocalStorage()?.setItem(key(org, project), text);
}

export function readCreatePrompt(org: string, project: string): string | null {
  return safeLocalStorage()?.getItem(key(org, project)) ?? null;
}

export function clearCreatePrompt(org: string, project: string): void {
  safeLocalStorage()?.removeItem(key(org, project));
}

// The canned generation instructions these prompts seed
// (buildSpecGenerationInstruction / buildDesignGenerationInstruction) moved to
// the shared `@aep/contracts/prompts` module — one source for the console and
// the root-level playground (docs/design/playground.md §9).
