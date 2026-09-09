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
 * BuildDependencyDrawer — what stands between Build and the version cut.
 *
 * The drawer LISTS, it does not resolve. Every row is a dependency the design
 * cannot yet be built against — no provider chosen, no contract on disk, an
 * assumption nobody accepted, an org-service this project cannot see — and
 * each links to the page where it is resolved. One button runs the guided flow
 * over all of them (`/resolve-dependencies`) and ends back here. Everything
 * else preflight reports (external config values, platform-resource approvals)
 * is collected on the Builds page while the coding agent runs and enforced at
 * the deploy gate, so it never opens this drawer.
 */

import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";
import { approvalInputsFor } from "../lib/buildInputs";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

/**
 * The kinds that block the cut. Anything else preflight reports rides along in
 * the build request as an approval and is settled elsewhere.
 */
const RESOLUTION_KINDS = new Set([
  "external-unresolved",
  "external-spec",
  "org-service",
]);

function isResolutionKind(kind: PreflightItem["kind"]): boolean {
  return RESOLUTION_KINDS.has(kind);
}

/** An external dependency has a definition to open; an org-service is resolved from the design view. */
function hasDefinition(kind: PreflightItem["kind"]): boolean {
  return kind !== "org-service";
}

function dependencyIdentity(item: PreflightItem): string {
  return `${item.kind}:${item.dependency}`;
}

interface DependencyGroup {
  key: string;
  items: PreflightItem[];
  representative: PreflightItem;
  usedBy: string[];
}

/** One row per dependency, however many components declare it. */
export function groupPreflightItems(items: PreflightItem[]): DependencyGroup[] {
  const buckets = new Map<string, PreflightItem[]>();
  for (const item of items) {
    const key = dependencyIdentity(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const groups: DependencyGroup[] = [];
  for (const [key, bucketItems] of buckets) {
    const sorted = [...bucketItems].sort((a, b) =>
      a.component.localeCompare(b.component),
    );
    groups.push({
      key,
      items: sorted,
      representative: sorted[0]!,
      usedBy: [...new Set(sorted.map((i) => i.component))].sort(),
    });
  }
  return groups;
}

function UsedByLine({ usedBy }: { usedBy: string[] }) {
  if (usedBy.length < 2) return null;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
      <Typography variant="caption" color="text.secondary">
        Used by:
      </Typography>
      {usedBy.map((name) => (
        <Chip key={name} size="small" variant="outlined" label={name} />
      ))}
    </Stack>
  );
}

function DependencyRow({
  group,
  onOpen,
}: {
  group: DependencyGroup;
  onOpen?: ((name: string) => void) | undefined;
}) {
  const item = group.representative;
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="subtitle1">{item.dependency}</Typography>
        {onOpen && hasDefinition(item.kind) && (
          <Button size="small" onClick={() => onOpen(item.dependency)}>
            Open
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      <UsedByLine usedBy={group.usedBy} />
    </Stack>
  );
}

export function BuildDependencyDrawer({
  open,
  items,
  submitting = false,
  onClose,
  onContinue,
  onOpenDependency,
  onResolveAll,
}: {
  open: boolean;
  items: PreflightItem[];
  submitting?: boolean;
  onClose: () => void;
  onContinue: (inputs: BuildInputItem[]) => void;
  /** Selects the dependency's page in the spec view (and the caller closes the drawer). */
  onOpenDependency?: ((name: string) => void) | undefined;
  /** Runs the guided flow over every open dependency. */
  onResolveAll?: (() => void) | undefined;
}) {
  const groups = groupPreflightItems(items.filter((i) => isResolutionKind(i.kind)));
  const canContinue = groups.length === 0;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Force an opaque surface: the theme's `background.paper` is itself
      // semi-transparent (a glass surface), so the page behind bleeds through
      // and the dependency text is hard to read. `background.default` is the
      // fully-opaque version of the same surface.
      slotProps={{
        paper: {
          sx: {
            bgcolor: "background.default",
            backgroundImage: "none",
            backdropFilter: "none",
          },
        },
      }}
    >
      <Box sx={{ width: 420, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Dependencies to resolve
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {groups.length === 0
            ? "Everything is resolved — continue to build."
            : "The version cannot be cut until each of these has a provider and a contract on file. Resolve them one by one from their definitions, or let the agent walk you through all of them."}
        </Typography>

        {groups.length > 0 && (
          <>
            <Stack spacing={2.5} sx={{ mb: 3 }}>
              {groups.map((group) => (
                <DependencyRow key={group.key} group={group} onOpen={onOpenDependency} />
              ))}
            </Stack>
            {onResolveAll && (
              <Button variant="contained" fullWidth sx={{ mb: 3 }} onClick={onResolveAll}>
                Resolve all in chat
              </Button>
            )}
            <Divider sx={{ mb: 3 }} />
          </>
        )}

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            loading={submitting}
            disabled={!canContinue || submitting}
            onClick={() => onContinue(approvalInputsFor(items))}
          >
            Continue
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
