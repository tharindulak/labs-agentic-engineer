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

import { Button } from "@wso2/oxygen-ui";
import { Compass } from "@wso2/oxygen-ui-icons-react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "./EmptyState";

// The router's `defaultNotFoundComponent` (Task 4) — rendered by
// `router.ts` for any unmatched URL. It mounts inside the root route's
// outlet, so it renders inside the signed-in app shell (header/sidebar),
// not as a bare page.
export function NotFound() {
  return (
    <EmptyState
      icon={<Compass size={48} />}
      title="Page not found"
      description="The page you're looking for doesn't exist or may have moved."
      action={
        <Button variant="contained" component={Link} to="/">
          Back to Projects
        </Button>
      }
    />
  );
}
