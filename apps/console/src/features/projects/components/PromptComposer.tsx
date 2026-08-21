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

import { useState, type DragEvent } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputBase,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Paperclip, Send, X } from "@wso2/oxygen-ui-icons-react";
import {
  MAX_REFERENCE_FILES,
  REFERENCE_ACCEPT,
  referenceTypeLabel,
  screenReferenceFiles,
  type RejectedFile,
} from "../lib/referenceFiles";

const CARD_WIDTH = 132;
const CARD_HEIGHT = 108;

// One attached reference. The name is the whole card — no size, because an
// oversized file never becomes a card (it becomes a rejection notice below), so
// the only thing left worth saying is which kind of document this is.
//
// The remove control sits OUTSIDE the card's corner and is revealed on hover.
// It is opacity-toggled rather than mounted on hover so it stays in the tab
// order: `:focus-within` brings it back for keyboard users, who get no hover.
function ReferenceCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <Box
      sx={{
        position: "relative",
        flexShrink: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        p: 1.25,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        "&:hover .reference-card-remove, &:focus-within .reference-card-remove": {
          opacity: 1,
          pointerEvents: "auto",
        },
      }}
    >
      <Typography
        variant="body2"
        title={file.name}
        sx={{
          overflow: "hidden",
          // Four lines, then ellipsis: a hashed export name fills the card and
          // a short one leaves the badge where the eye expects it.
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 4,
          wordBreak: "break-word",
          lineHeight: 1.35,
        }}
      >
        {file.name}
      </Typography>
      <Box
        sx={{
          alignSelf: "flex-start",
          px: 0.75,
          py: 0.25,
          borderRadius: 0.75,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {referenceTypeLabel(file.name)}
        </Typography>
      </Box>
      <Tooltip title={`Remove ${file.name}`}>
        <IconButton
          className="reference-card-remove"
          size="small"
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: "translate(-40%, -40%)",
            opacity: 0,
            pointerEvents: "none",
            transition: "opacity 120ms",
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            "&:hover": { bgcolor: "action.hover" },
            "&:focus-visible": { opacity: 1, pointerEvents: "auto" },
          }}
        >
          <X size={12} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * The create view's prompt box (#383): one composer holding the typed idea and
 * its attached reference documents, replacing the old textarea + separate
 * dashed drop zone. The whole box is the drop target, so there is no second
 * affordance to find.
 *
 * Screening (type, size, count, duplicate path) happens on selection; each
 * rejection surfaces as its own notice and clears on the next selection —
 * never a silent drop.
 */
export function PromptComposer({
  prompt,
  onPromptChange,
  files,
  onFilesChange,
  onSubmit,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onSubmit: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const screening = screenReferenceFiles(files, Array.from(incoming));
    setRejected(screening.rejected);
    if (screening.accepted.length > 0) {
      onFilesChange([...files, ...screening.accepted]);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <Stack spacing={1}>
      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={drop}
        sx={{
          p: 1.5,
          borderRadius: 2,
          border: "1px solid",
          borderColor: dragOver ? "primary.main" : "divider",
          bgcolor: dragOver ? "action.hover" : "background.paper",
          "&:focus-within": { borderColor: "primary.main" },
        }}
      >
        {files.length > 0 && (
          <Box
            sx={{
              display: "flex",
              gap: 1,
              mb: 1.5,
              // Scroll rather than wrap: the composer must not grow taller as
              // documents are added, or the Start button walks down the page.
              overflowX: "auto",
              // Room for the remove button, which is translated OUTSIDE each
              // card's top-left corner. `overflow-x: auto` makes this a scroll
              // container, and a scroll container clips on BOTH axes — setting
              // one axis to a non-visible value computes the other to `auto`
              // rather than leaving it `visible`. So the button was cut off
              // against this box's top and left edges. The padding has to
              // exceed the button's translated overhang (~10px at size
              // "small"), not merely be non-zero.
              pt: 1.5,
              pl: 1.5,
            }}
          >
            {files.map((file) => (
              <ReferenceCard
                key={file.name}
                file={file}
                onRemove={() =>
                  onFilesChange(files.filter((f) => f.name !== file.name))
                }
              />
            ))}
          </Box>
        )}
        <InputBase
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="e.g. A service desk where employees raise IT requests and the team tracks them through to resolution"
          multiline
          minRows={3}
          autoFocus
          fullWidth
          sx={{ px: 0.5, alignItems: "flex-start" }}
        />
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "space-between", mt: 1 }}
        >
          <Tooltip
            title={
              /* The hint the old drop zone spelled out in a paragraph. It has
                 to stay reachable somewhere, and the attach control is where
                 someone with reference material looks first.

                 No extension list: it is 16 entries now, which turned a hint
                 into a wall of text nobody reads. The file picker already
                 filters by `accept`, and picking an unsupported file answers
                 with a rejection notice naming the accepted set — so the list
                 is available exactly where it matters, at the point of
                 failure, rather than in front of everyone every time. */
              `Attach reference documents — a PRD, notes, an API spec. Agents read them when deriving your requirements. Up to ${MAX_REFERENCE_FILES} files, 5 MB each.`
            }
          >
            <IconButton component="label" size="small" aria-label="Attach reference documents">
              <Paperclip size={18} />
              <input
                type="file"
                accept={REFERENCE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  // Same file re-selected after a remove must re-fire onChange.
                  e.target.value = "";
                }}
              />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            // Icon on both ends of the toolbar row: the paperclip opens the
            // picker, this sends. Same shape as the Back button's startIcon
            // elsewhere in the flow.
            endIcon={<Send size={16} />}
            disabled={!prompt.trim()}
            onClick={onSubmit}
          >
            Start
          </Button>
        </Stack>
      </Box>
      {/* Keyed and dismissed by position, not by name: one selection can reject
          two files under the same name (a duplicate, or two oversized copies),
          and name identity would collapse them into one notice and then close
          both at once. */}
      {rejected.map(({ name, reason }, index) => (
        <Alert
          key={`${index}-${name}`}
          severity="warning"
          onClose={() =>
            setRejected((prev) => prev.filter((_, i) => i !== index))
          }
        >
          {/* The reason renders verbatim: lower-casing it turned "Larger than
              5 MB" into "5 mb" and mangled the casing of the user's own file
              name in the collision reason. */}
          <strong>{name}</strong> was not attached — {reason}.
        </Alert>
      ))}
    </Stack>
  );
}
