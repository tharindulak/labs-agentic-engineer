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
import { Link } from "@tanstack/react-router";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Pagination,
  SearchBar,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Eye, FolderGit2, Pencil, Trash2, Upload } from "@wso2/oxygen-ui-icons-react";
import { StatusChip } from "../../../components/StatusChip";
import {
  useConfig,
  useDeleteSkill,
  useSkillUpdates,
  useSkills,
  useSyncSkills,
} from "../api/queries";
import { kindBlurb, kindChipTone, kindLabel, normalizeKind } from "../skillKind";
import { paginateSkills } from "../skillsList";
import { EditSkillDialog } from "./EditSkillDialog";
import { ImportSkillDialog } from "./ImportSkillDialog";
import { SkillViewerDialog } from "./SkillViewerDialog";
import { SyncUpdatesControl } from "./SyncUpdatesControl";

const PAGE_SIZE = 10;

export function SkillsSection() {
  const {
    data: config,
    isLoading: configLoading,
    isError: configIsError,
    error: configError,
    refetch: refetchConfig,
  } = useConfig();
  const { data, isLoading, isError, error, refetch } = useSkills();
  const { data: updates } = useSkillUpdates();

  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [requestedPage, setRequestedPage] = useState(1);
  const [viewTarget, setViewTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteSkill = useDeleteSkill();
  const syncSkills = useSyncSkills();

  if (configLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  // A failed GET /config leaves `config` undefined, which would otherwise fall
  // through to the not-connected branch below and blame the user for a server
  // error. Distinguish the two.
  if (configIsError) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetchConfig()}>Retry</Button>}
      >
        {configError?.message ?? "Failed to load the organization configuration"}
      </Alert>
    );
  }

  if (!config?.gitProvider) {
    return (
      <Alert
        severity="info"
        icon={<FolderGit2 size={20} />}
        action={
          <Button component={Link} to="/settings/credentials">
            Connect GitHub
          </Button>
        }
      >
        The skills catalogue lives in the org's GitHub repo — connect GitHub
        first.
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetch()}>Retry</Button>}
      >
        {error?.message ?? "Failed to load skills"}
      </Alert>
    );
  }

  const { skills, repoUrl } = data;
  const updatable = new Set((updates ?? []).map((u) => u.name));
  const syncedCount = syncSkills.data?.updated ?? 0;

  // Filter → sort → clamp → slice as one pure derivation: a list that shrinks
  // underneath the current page (delete, sync) lands on the nearest still-
  // valid page without any effect re-syncing state.
  const query = search.trim();
  const { rows, page, pageCount, total } = paginateSkills(
    skills,
    query,
    requestedPage,
    PAGE_SIZE,
  );

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteSkill.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Skills shape what the platform's agents emit — code patterns,
        conventions, and project layout. Org and platform skills ship with the
        platform and are read-only; import AgentSkills from the ecosystem to
        extend them.
      </Typography>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1,
          mb: 2,
        }}
      >
        <Box sx={{ width: { xs: "100%", sm: 320 } }}>
          <SearchBar
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // A new query re-filters from scratch — page 1 is the only
              // page that is meaningful for it.
              setRequestedPage(1);
            }}
            placeholder="Search skills..."
          />
        </Box>
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
        >
          <SyncUpdatesControl
            count={updates?.length ?? 0}
            pending={syncSkills.isPending}
            onSync={() => syncSkills.mutate()}
          />
          <Button
            variant="contained"
            startIcon={<Upload size={18} />}
            onClick={() => setImportOpen(true)}
          >
            Import
          </Button>
        </Box>
      </Box>

      {syncSkills.isSuccess && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => syncSkills.reset()}
        >
          {syncedCount > 0
            ? `Synced ${syncedCount} built-in skill${syncedCount === 1 ? "" : "s"} to the latest content.`
            : "Built-in skills are already up to date."}
        </Alert>
      )}
      {syncSkills.isError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => syncSkills.reset()}>
          {syncSkills.error.message}
        </Alert>
      )}

      {total === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontStyle: "italic" }}
        >
          {query ? "No matches." : "None yet."}
        </Typography>
      ) : (
        <>
          <Card variant="outlined">
            <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
              {rows.map((skill, idx) => {
                const kind = normalizeKind(skill.kind);
                return (
                  <Box key={skill.name}>
                    {idx > 0 && <Divider />}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        px: 2,
                        py: 1.5,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            flexWrap: "wrap",
                          }}
                        >
                          <Typography variant="body1" fontWeight={600}>
                            {skill.name}
                          </Typography>
                          {/* The kind chip is the flat list's only kind
                              signal; its tooltip carries the kind's blurb,
                              including read-only-ness — there is no separate
                              read-only chip. */}
                          <Tooltip title={kindBlurb(kind)}>
                            {/* Box holds the ref Tooltip needs — StatusChip
                                doesn't forward one. */}
                            <Box sx={{ display: "inline-flex" }}>
                              <StatusChip
                                label={kindLabel(kind)}
                                tone={kindChipTone(kind)}
                              />
                            </Box>
                          </Tooltip>
                          {updatable.has(skill.name) && (
                            <StatusChip label="update available" tone="warning" />
                          )}
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          {skill.description}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                        {/* View is available for every kind — inspecting a
                            read-only org/platform skill's body is the whole
                            point of the viewer. */}
                        <Button
                          size="small"
                          startIcon={<Eye size={16} />}
                          onClick={() => setViewTarget(skill.name)}
                        >
                          View
                        </Button>
                        {skill.editable && (
                          <>
                            <Button
                              size="small"
                              startIcon={<Pencil size={16} />}
                              onClick={() => setEditTarget(skill.name)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<Trash2 size={16} />}
                              onClick={() => setDeleteTarget(skill.name)}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </CardContent>
          </Card>
          {/* Hidden on a single page — it would be dead UI. */}
          {pageCount > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Pagination
                count={pageCount}
                page={page}
                onChange={(_, next) => setRequestedPage(next)}
              />
            </Box>
          )}
        </>
      )}

      <ImportSkillDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        repoUrl={repoUrl}
      />
      <SkillViewerDialog
        name={viewTarget}
        onClose={() => setViewTarget(null)}
      />
      <EditSkillDialog name={editTarget} onClose={() => setEditTarget(null)} />

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete {deleteTarget}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes the skill from your organization's skills repo. Agents
            read skills at the repo's latest commit, so in-flight tasks simply
            stop seeing it.
          </DialogContentText>
          {deleteSkill.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteSkill.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDelete}
            disabled={deleteSkill.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
