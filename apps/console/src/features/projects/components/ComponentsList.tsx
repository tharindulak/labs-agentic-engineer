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

import { useState } from "react";
import { Card, Chip, Tooltip } from "@wso2/oxygen-ui";
import { Box as BoxIcon, Boxes } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import type { components } from "../../../generated/aep-api";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";
import { OverviewRow } from "./OverviewRow";

type Component = components["schemas"]["Component"];

// The component type is OpenChoreo's own ComponentType name, end-to-end.
const isWebApp = (c: Component) => c.type === "web-application";

const typeLabel = (c: Component) => (isWebApp(c) ? "Web app" : "Service");

/**
 * The project's components.
 *
 * These were one bordered card per component, with an avatar carrying the first
 * letter of a name printed right beside it. They are now `OverviewRow`s, which
 * is the build page's task row: a reader moving between the two pages should
 * not have to work out what a row is twice.
 *
 * The Dependencies list below uses the same row for the same reason. One column
 * running two densities was what made this page feel loose.
 *
 * Deliberately state-free. A component's build state used to be rolled up from
 * its tasks, but an issue no longer names a component — issue bodies are prose
 * the platform writes and never reads back — so the roll-up had no input left.
 * What is running lives on the deployments board, which reads the cluster.
 */
export function ComponentsList({
  projectName,
  items,
}: {
  projectName: string;
  items: Component[];
}) {
  const [contractComponent, setContractComponent] = useState<string | null>(
    null,
  );

  if (items.length === 0) {
    return (
      <EmptyState
        bordered
        icon={<Boxes size={28} />}
        title="No components yet"
        description="Components are the services and apps your design is made of, and they appear as agents build them."
      />
    );
  }

  return (
    <>
      <Card variant="outlined">
        {items.map((c, i) => {
          // A web app has no contract to open, so its row goes nowhere and
          // shows no chevron: only rows that do something look like they do.
          const openable = !isWebApp(c);
          const row = (
            <OverviewRow
              icon={<BoxIcon size={18} />}
              title={c.displayName ?? c.name}
              trailing={
                <Chip
                  size="small"
                  variant="outlined"
                  label={typeLabel(c)}
                  sx={{ height: 22, flexShrink: 0, fontSize: "0.75rem" }}
                />
              }
              caption={c.description ?? undefined}
              last={i === items.length - 1}
              {...(openable && { onClick: () => setContractComponent(c.name) })}
            />
          );
          return openable ? (
            <Tooltip key={c.name} title="View API contract" placement="left">
              <div>{row}</div>
            </Tooltip>
          ) : (
            <div key={c.name}>{row}</div>
          );
        })}
      </Card>
      <ComponentOpenApiDialog
        projectName={projectName}
        componentName={contractComponent}
        onClose={() => setContractComponent(null)}
      />
    </>
  );
}
