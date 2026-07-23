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

import type { ReactNode } from "react";
import { Stack, Typography } from "@wso2/oxygen-ui";

// One section-heading pattern for the whole console: a heading with
// consistent spacing below, and an optional trailing slot for inline
// chips/counts (e.g. the deployments board's env count + version). Used above
// the overview's Recent activity / Components sections, the builds Tasks list,
// and the deployments Development / Production boards so every section reads
// the same.
export function SectionTitle({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
      <Typography variant="h6">{children}</Typography>
      {trailing}
    </Stack>
  );
}
