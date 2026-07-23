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

import { useQuery } from "@tanstack/react-query";
import { deriveWireframeScene } from "../derive/deriveWireframe";
import { fetchSpecFileContent } from "./queries";
import { specKeys } from "./keys";

export function useDerivedWireframe(
  projectName: string,
  dslPath: string,
  sha: string | undefined,
): { scene: string | null; isPending: boolean; isError: boolean } {
  // The Files API reads by PATH at HEAD — `sha` is never sent to the server
  // (see fetchSpecFileContent); it is only a cache key. So fetch whenever we
  // have a path, even before the committed file-list catches up with an
  // agent-created file (whose sha is still unknown). Gating `enabled` on `sha`
  // left the query permanently disabled, so `isPending` stayed true forever —
  // an infinite spinner on a file that was perfectly fetchable by path.
  const q = useQuery({
    queryKey: specKeys.file(projectName, dslPath, sha ?? "head"),
    enabled: Boolean(dslPath),
    // A content sha pins immutable content; without one we're reading HEAD, so
    // revalidate instead of caching a pre-commit read forever.
    staleTime: sha ? Infinity : 0,
    queryFn: () => fetchSpecFileContent(projectName, { path: dslPath, sha: sha ?? "" }),
  });
  const scene =
    q.data?.content != null ? deriveWireframeScene(dslPath, q.data.content) : null;
  return { scene, isPending: q.isPending, isError: q.isError };
}
