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
import { useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Grid,
  Tab,
  Tabs,
  Typography,
} from "@wso2/oxygen-ui";
import { Boxes, Plug } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { useExternalResources, usePlatformResourceTypes } from "../api/queries";
import { ResourceDrawer } from "./ResourceDrawer";

type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];

type ResourceTabValue = "platform" | "external";

// Lifted here (not in the drawer) because it also drives `open` — the drawer
// is a controlled shell that Task 4 fills in with the resource-specific body.
type ResourceSelection =
  | { kind: "platform"; resource: PlatformResourceTypeDTO }
  | { kind: "external"; resource: ExternalResourceDTO };

function ResourceEmptyState({
  icon,
  headline,
  body,
}: {
  icon: ReactNode;
  headline: string;
  body: string;
}) {
  return (
    <Box sx={{ textAlign: "center", py: 8 }}>
      {icon}
      <Typography variant="h6" gutterBottom>
        {headline}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {body}
      </Typography>
    </Box>
  );
}

// Shared by both tabs — no overflow menu, no delete (that lives in the
// drawer, Task 4). Clicking anywhere on the card opens it.
function ResourceCard<T extends { name: string; description?: string; consumers?: unknown[] | null }>({
  resource,
  onOpen,
}: {
  resource: T;
  onOpen: (resource: T) => void;
}) {
  const usedBy = resource.consumers?.length ?? 0;
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardActionArea
        sx={{ height: "100%", alignItems: "stretch" }}
        onClick={() => onOpen(resource)}
      >
        <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <Typography variant="h6" gutterBottom>
            {resource.name}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              flexGrow: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {resource.description}
          </Typography>
          {usedBy > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5 }}>
              Used by {usedBy}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function ResourceGrid<T extends { name: string; description?: string; consumers?: unknown[] | null }>({
  items,
  onOpen,
}: {
  items: T[];
  onOpen: (resource: T) => void;
}) {
  return (
    <Grid container spacing={3}>
      {items.map((resource) => (
        <Grid key={resource.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <ResourceCard resource={resource} onOpen={onOpen} />
        </Grid>
      ))}
    </Grid>
  );
}

function PlatformResourcesTab({
  onOpen,
}: {
  onOpen: (resource: PlatformResourceTypeDTO) => void;
}) {
  const { data, isLoading, isError, error } = usePlatformResourceTypes();

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress aria-label="Loading platform resources" />
      </Box>
    );
  }

  if (isError) {
    return (
      <Alert severity="error">
        {error?.message ?? "Failed to load platform resource types"}
      </Alert>
    );
  }

  const items = data ?? [];
  if (items.length === 0) {
    return (
      <ResourceEmptyState
        icon={<Boxes size={48} aria-hidden style={{ opacity: 0.3, marginBottom: 16 }} />}
        headline="No platform resources"
        body="No platform resource types are installed — a platform engineer installs these into the cluster."
      />
    );
  }

  return <ResourceGrid items={items} onOpen={onOpen} />;
}

function ExternalResourcesTab({
  onOpen,
}: {
  onOpen: (resource: ExternalResourceDTO) => void;
}) {
  const { data, isLoading, isError, error } = useExternalResources();

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress aria-label="Loading external resources" />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">{error?.message ?? "Failed to load external resources"}</Alert>;
  }

  const items = data ?? [];
  if (items.length === 0) {
    return (
      <ResourceEmptyState
        icon={<Plug size={48} aria-hidden style={{ opacity: 0.3, marginBottom: 16 }} />}
        headline="No external resources"
        body="External resources appear here once a third-party dependency is provisioned in a project."
      />
    );
  }

  return <ResourceGrid items={items} onOpen={onOpen} />;
}

export function ResourcesSection() {
  const [tab, setTab] = useState<ResourceTabValue>("platform");
  const [selection, setSelection] = useState<ResourceSelection | null>(null);

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value as ResourceTabValue)}
        aria-label="Resource categories"
        sx={{ mb: 3 }}
      >
        <Tab
          value="platform"
          icon={<Boxes size={16} />}
          iconPosition="start"
          label="Platform Resources"
        />
        <Tab
          value="external"
          icon={<Plug size={16} />}
          iconPosition="start"
          label="External Resources"
        />
      </Tabs>

      {tab === "platform" ? (
        <PlatformResourcesTab
          onOpen={(resource) => setSelection({ kind: "platform", resource })}
        />
      ) : (
        <ExternalResourcesTab
          onOpen={(resource) => setSelection({ kind: "external", resource })}
        />
      )}

      <ResourceDrawer
        {...(selection ?? { kind: null, resource: null })}
        open={selection !== null}
        onClose={() => setSelection(null)}
      />
    </Box>
  );
}
