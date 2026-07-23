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

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { MarkdownView } from "../../../components/MarkdownView";
import { useSkill, useUpdateSkill } from "../api/queries";
import { splitFrontmatter } from "../skillMd";

// Raw monospace, not a WYSIWYG: a SKILL.md is YAML frontmatter + markdown, and
// round-tripping it through a rich-text editor would corrupt the frontmatter
// (issue #143 decision). Preview renders the body the way an agent's reader
// would see it.
export function EditSkillDialog({
  name,
  onClose,
}: {
  name: string | null;
  onClose: () => void;
}) {
  const { data: skill, isLoading } = useSkill(name ?? "");
  const updateSkill = useUpdateSkill(name ?? "");

  const [skillMd, setSkillMd] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    if (skill) setSkillMd(skill.skillMd);
  }, [skill]);

  // Reset the tab each time a different skill is opened.
  useEffect(() => {
    if (name !== null) setTab("edit");
  }, [name]);

  const dirty = skill != null && skillMd !== skill.skillMd;

  const close = () => {
    updateSkill.reset();
    onClose();
  };

  const submit = () => {
    if (!skill) return;
    updateSkill.mutate(
      { skillMd, references: skill.references },
      { onSuccess: close },
    );
  };

  const { body } = splitFrontmatter(skillMd);

  return (
    <Dialog open={name !== null} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>Edit {name}</DialogTitle>

      <DialogContent
        dividers
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v as typeof tab)}>
              <Tab value="edit" label="Edit" />
              <Tab value="preview" label="Preview" />
            </Tabs>

            {tab === "edit" ? (
              <TextField
                label="SKILL.md"
                value={skillMd}
                onChange={(e) => setSkillMd(e.target.value)}
                multiline
                minRows={16}
                fullWidth
                slotProps={{
                  input: { sx: { fontFamily: "monospace", fontSize: 13 } },
                }}
              />
            ) : (
              <Box sx={{ minHeight: 320, py: 1 }}>
                {body.trim() ? (
                  <MarkdownView>{body}</MarkdownView>
                ) : (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontStyle: "italic" }}
                  >
                    Nothing to preview — this skill has no body beyond its
                    frontmatter.
                  </Typography>
                )}
              </Box>
            )}
          </>
        )}

        {updateSkill.isError && (
          <Alert severity="error">{updateSkill.error.message}</Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!skillMd.trim() || !dirty || updateSkill.isPending || isLoading}
        >
          {updateSkill.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
