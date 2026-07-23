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

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from "@wso2/oxygen-ui";
import { MarkdownView } from "../../../components/MarkdownView";
import { StatusChip } from "../../../components/StatusChip";
import { useSkill } from "../api/queries";
import { kindChipTone, kindLabel, normalizeKind } from "../skillKind";
import { splitFrontmatter } from "../skillMd";

// Read-only inspection of any skill, of any kind — the only way to see what an
// org/platform skill actually instructs an agent to do.
export function SkillViewerDialog({
  name,
  onClose,
}: {
  name: string | null;
  onClose: () => void;
}) {
  const { data: skill, isLoading, isError, error } = useSkill(name ?? "");

  const kind = skill ? normalizeKind(skill.kind) : null;
  const { frontmatter, body } = splitFrontmatter(skill?.skillMd ?? "");
  const references = Object.entries(skill?.references ?? {});

  return (
    <Dialog open={name !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}
        >
          <Typography variant="h6" fontWeight={700}>
            {name}
          </Typography>
          {kind && (
            <StatusChip
              label={kindLabel(kind)}
              tone={kindChipTone(kind)}
              variant="outlined"
            />
          )}
          {skill && !skill.editable && (
            <Chip size="small" variant="outlined" label="read-only" />
          )}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {isError && (
          <Alert severity="error">
            {error?.message ?? "Failed to load the skill"}
          </Alert>
        )}

        {skill && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {skill.description}
            </Typography>

            {frontmatter && (
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mb: 0.5 }}
                >
                  Frontmatter
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    fontFamily: "monospace",
                    fontSize: 12,
                    overflowX: "auto",
                  }}
                >
                  {frontmatter}
                </Box>
              </Box>
            )}

            <Divider />

            {body.trim() ? (
              <MarkdownView>{body}</MarkdownView>
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: "italic" }}
              >
                This skill has no body beyond its frontmatter.
              </Typography>
            )}

            {references.length > 0 && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={700}>
                  Reference files ({references.length})
                </Typography>
                {references.map(([path, content]) => (
                  <Box key={path}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mb: 0.5, fontFamily: "monospace" }}
                    >
                      {path}
                    </Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                        fontFamily: "monospace",
                        fontSize: 12,
                        overflowX: "auto",
                      }}
                    >
                      {content}
                    </Box>
                  </Box>
                ))}
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
