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

import { type ReactNode, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Link,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ChevronDown, Lock, X } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";

// Router-typed Oxygen Link (the console's createLink pattern, cf. ValidationPage)
// so a "Used by" consumer can navigate to its project.
const ProjectLink = createLink(Link);
import { useDeleteExternalResource } from "../api/queries";

type PlatformResourceTypeDTO = components["schemas"]["PlatformResourceTypeDTO"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];
type ConfigKeyDTO = components["schemas"]["ConfigKeyDTO"];
type ConsumerDTO = components["schemas"]["ConsumerDTO"];

// Discriminated on `kind` so the drawer body (Task 4) can narrow `resource`
// to the right DTO. `kind: null` is the "nothing selected" resting state —
// the drawer still mounts (so its close transition can animate) but has
// nothing to show.
export type ResourceDrawerProps = {
  open: boolean;
  onClose: () => void;
} & (
  | { kind: "platform"; resource: PlatformResourceTypeDTO }
  | { kind: "external"; resource: ExternalResourceDTO }
  | { kind: null; resource: null }
);

// Muted single-line filler for a section with no items — never an empty
// accordion body.
function EmptyNote() {
  return (
    <Typography variant="body2" color="text.secondary">
      None
    </Typography>
  );
}

// Collapse rule (Global Constraints): expanded by default when the section
// holds 5 or fewer items, collapsed above that.
function CollapsibleSection({
  title,
  itemCount,
  children,
}: {
  title: string;
  itemCount: number;
  children: ReactNode;
}) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      defaultExpanded={itemCount <= 5}
      sx={{ "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        <Typography variant="subtitle2">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

// Read-only key chip — mirrors ConfigChip in design-view/DesignView.tsx:
// secret keys get the warning color + lock icon.
function ConfigKeyRow({ entry }: { entry: ConfigKeyDTO }) {
  return (
    <Box>
      <Chip
        size="small"
        variant="outlined"
        label={entry.key}
        color={entry.secret ? "warning" : "default"}
        {...(entry.secret ? { icon: <Lock size={14} data-testid="secret-icon" /> } : {})}
      />
      {entry.description && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {entry.description}
        </Typography>
      )}
    </Box>
  );
}

function ConfigKeysSection({ config }: { config: ConfigKeyDTO[] }) {
  return (
    <CollapsibleSection title="Config keys" itemCount={config.length}>
      {config.length === 0 ? (
        <EmptyNote />
      ) : (
        <Stack spacing={1.5}>
          {config.map((entry) => (
            <ConfigKeyRow key={entry.key} entry={entry} />
          ))}
        </Stack>
      )}
    </CollapsibleSection>
  );
}

function ConsumersSection({ consumers }: { consumers: ConsumerDTO[] }) {
  return (
    <CollapsibleSection title="Used by" itemCount={consumers.length}>
      {consumers.length === 0 ? (
        <EmptyNote />
      ) : (
        // Each consumer is one component (in a project) that declares this
        // external dependency; the component name links to its project (there
        // is no per-component route — components live inside the project view).
        <Box component="ul" sx={{ listStyleType: "disc", m: 0, pl: 2.5 }}>
          {consumers.map((consumer) => (
            <Box
              component="li"
              key={`${consumer.projectId}/${consumer.componentName}`}
              sx={{ mb: 0.5, "&::marker": { color: "text.disabled" } }}
            >
              <ProjectLink
                to="/projects/$projectName"
                params={{ projectName: consumer.projectId }}
                variant="body2"
              >
                {consumer.componentName} · {consumer.projectId}
              </ProjectLink>
            </Box>
          ))}
        </Box>
      )}
    </CollapsibleSection>
  );
}

// `parameters` values are `unknown` (a raw JSON-Schema-ish object from the
// platform resource type) — surface `type`/`description` when present,
// otherwise fall back to just the key name.
function ParametersSection({ parameters }: { parameters: Record<string, unknown> }) {
  const keys = Object.keys(parameters);
  return (
    <CollapsibleSection title="Parameters (inputs)" itemCount={keys.length}>
      {keys.length === 0 ? (
        <EmptyNote />
      ) : (
        <Stack spacing={1.5}>
          {keys.map((key) => {
            const schema = parameters[key];
            const info =
              schema && typeof schema === "object" ? (schema as Record<string, unknown>) : undefined;
            const type = typeof info?.type === "string" ? info.type : undefined;
            const description =
              typeof info?.description === "string" ? info.description : undefined;
            return (
              <Box key={key}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography component="code" variant="body2">
                    {key}
                  </Typography>
                  {type && <Chip size="small" variant="outlined" label={type} />}
                </Stack>
                {description && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    {description}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
    </CollapsibleSection>
  );
}

function OutputsSection({ outputs }: { outputs: string[] }) {
  return (
    <CollapsibleSection title="Outputs" itemCount={outputs.length}>
      {outputs.length === 0 ? (
        <EmptyNote />
      ) : (
        <Box component="ul" sx={{ listStyleType: "disc", m: 0, pl: 2.5 }}>
          {outputs.map((output) => (
            <Box
              component="li"
              key={output}
              sx={{ mb: 0.5, "&::marker": { color: "text.disabled" } }}
            >
              <Typography component="code" variant="body2">
                {output}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </CollapsibleSection>
  );
}

// Delete footer (external only) — the in-use guard disables the button and
// explains why; confirming goes through a DeleteProjectDialog-shaped modal.
function DeleteResourceSection({
  resource,
  consumers,
  onClose,
}: {
  resource: ExternalResourceDTO;
  consumers: ConsumerDTO[];
  onClose: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteResource = useDeleteExternalResource();
  const busy = deleteResource.isPending;
  const inUse = consumers.length > 0;

  const closeConfirm = () => {
    if (busy) return;
    deleteResource.reset();
    setConfirmOpen(false);
  };

  const confirmDelete = () => {
    deleteResource.mutate(resource.name, { onSuccess: onClose });
  };

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Button
        color="error"
        variant="outlined"
        disabled={inUse}
        onClick={() => setConfirmOpen(true)}
      >
        Delete resource
      </Button>
      {inUse && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Used by {consumers.length} component(s) — remove those dependencies first
        </Typography>
      )}
      <Dialog open={confirmOpen} onClose={closeConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {resource.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes the external resource definition. This cannot be undone.
          </DialogContentText>
          {deleteResource.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteResource.error instanceof Error && deleteResource.error.message
                ? deleteResource.error.message
                : "Failed to delete the external resource"}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirmDelete} variant="contained" color="error" loading={busy}>
            Delete resource
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function ExternalResourceBody({
  resource,
  onClose,
}: {
  resource: ExternalResourceDTO;
  onClose: () => void;
}) {
  const config = resource.config ?? [];
  const consumers = resource.consumers ?? [];
  return (
    <Box sx={{ mt: 2 }}>
      <ConfigKeysSection config={config} />
      <ConsumersSection consumers={consumers} />
      <DeleteResourceSection resource={resource} consumers={consumers} onClose={onClose} />
    </Box>
  );
}

function PlatformResourceBody({ resource }: { resource: PlatformResourceTypeDTO }) {
  const parameters = resource.parameters ?? {};
  const outputs = resource.outputs ?? [];
  const consumers = resource.consumers ?? [];
  return (
    <Box sx={{ mt: 2 }}>
      <ParametersSection parameters={parameters} />
      <OutputsSection outputs={outputs} />
      <ConsumersSection consumers={consumers} />
    </Box>
  );
}

// Shell: header (name + close) and description, plus the resource-specific
// sections (parameters/outputs/config, consumers, delete) added by Task 4.
export function ResourceDrawer(props: ResourceDrawerProps) {
  const { resource, open, onClose } = props;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Force an opaque surface — see BuildDependencyDrawer for why the
      // theme's default `background.paper` (semi-transparent) is unusable here.
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
      <Box sx={{ width: 440, p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {resource?.name}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        {resource?.description && (
          <Typography variant="body2" color="text.secondary">
            {resource.description}
          </Typography>
        )}
        {props.kind === "external" && (
          <ExternalResourceBody resource={props.resource} onClose={onClose} />
        )}
        {props.kind === "platform" && <PlatformResourceBody resource={props.resource} />}
      </Box>
    </Drawer>
  );
}
