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
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Eye, EyeOff, Radio } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { useClearSreLlm, useSetSreLlm } from "../api/queries";

type SreLlmProjection = components["schemas"]["SreLlmProjection"];
type SreLlmProvider = SreLlmProjection["provider"];

const PROVIDERS: { value: SreLlmProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
];

const MODELS_BY_PROVIDER: Record<SreLlmProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
};

/**
 * The provider, model, and key the SRE agent bills for root-cause analysis —
 * a platform-wide setting distinct from the organization's Anthropic key
 * (`AnthropicCredentialCard`) and from the coding agent's key
 * (`CodingAgentCard`/`CodingAgentKeySection`). Unlike those two, the SRE agent
 * supports either provider, so a save always restates provider + model + key
 * together rather than overriding just one field.
 */
export function SreAgentLlmCard({ sreLlm }: { sreLlm: SreLlmProjection | null }) {
  const connected = sreLlm !== null;
  const [provider, setProvider] = useState<SreLlmProvider>(sreLlm?.provider ?? "openai");
  const [model, setModel] = useState(sreLlm?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const save = useSetSreLlm();
  const clear = useClearSreLlm();

  const submit = () => {
    save.mutate(
      { provider, model, apiKey },
      { onSuccess: () => setApiKey("") },
    );
  };

  const confirmDisconnect = () => {
    clear.mutate(undefined, { onSuccess: () => setDisconnectOpen(false) });
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <Radio size={22} />
          <Typography variant="h6">SRE agent</Typography>
          {connected ? (
            <Chip label={`${sreLlm.provider} · ${sreLlm.model}`} size="small" color="success" />
          ) : (
            <Chip label="not connected" size="small" color="warning" />
          )}
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          The provider, model, and key the SRE agent uses for root-cause
          analysis — platform-wide, distinct from the organization&apos;s
          Anthropic key above and from the coding agent&apos;s key. The SRE
          agent supports either provider by default.
        </Typography>

        {connected && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 3 }}>
            <Typography variant="body2" fontFamily="monospace">
              {sreLlm.keyPrefix}•••••••••{sreLlm.keyLast4}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Connected {new Date(sreLlm.connectedAt).toLocaleString()}
              {sreLlm.lastValidatedAt &&
                ` · last validated ${new Date(sreLlm.lastValidatedAt).toLocaleString()}`}
            </Typography>
            {sreLlm.validationError && (
              <Alert severity="warning">{sreLlm.validationError}</Alert>
            )}
          </Box>
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <TextField
              select
              fullWidth
              label="Provider"
              value={provider}
              disabled={save.isPending}
              onChange={(e) => {
                const next = e.target.value as SreLlmProvider;
                setProvider(next);
                setModel("");
              }}
            >
              {PROVIDERS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="Model"
              value={model}
              disabled={save.isPending}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS_BY_PROVIDER[provider].map((m) => (
                <MenuItem key={m.value} value={m.value}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <TextField
            label={connected ? "Replace API key" : "API key"}
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            fullWidth
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showKey ? "hide key" : "show key"}
                      onClick={() => setShowKey((v) => !v)}
                      edge="end"
                    >
                      {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          {save.isError && <Alert severity="error">{save.error.message}</Alert>}

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "space-between" }}>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!model || !apiKey || save.isPending}
            >
              {save.isPending ? "Validating…" : connected ? "Replace key" : "Save"}
            </Button>
            {connected && (
              <Button color="error" variant="outlined" onClick={() => setDisconnectOpen(true)}>
                Disconnect
              </Button>
            )}
          </Box>
        </Box>
      </CardContent>

      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Disconnect the SRE agent&apos;s LLM config?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The SRE agent will go back to using the platform&apos;s default
            Anthropic key wiring until this is reconfigured.
          </DialogContentText>
          {clear.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {clear.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDisconnect} disabled={clear.isPending}>
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
