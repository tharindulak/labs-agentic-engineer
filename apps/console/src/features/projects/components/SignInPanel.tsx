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
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Copy, ExternalLink, Eye } from "@wso2/oxygen-ui-icons-react";
import { env } from "../../../config/env";
import { thunderUsersConsoleHref } from "../../../config/thunderConsole";
import {
  useProjectRoles,
  useRevealTestUserPassword,
} from "../../spec/api/roles";
import {
  publishedTestUsers,
  type PublishedTestUser,
} from "../lib/publishedTestUsers";

function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return Promise.reject(new Error("Clipboard is not available"));
  }
  return navigator.clipboard.writeText(value);
}

function LoginRow({
  login,
  revealPassword,
}: {
  login: PublishedTestUser;
  revealPassword: (username: string) => Promise<string>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      setPassword(await revealPassword(login.username));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Tooltip
          title={
            login.coldStart ? `${login.role} · cold start` : login.role
          }
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", flexGrow: 1, minWidth: 0 }}
          >
            {login.username}
          </Typography>
        </Tooltip>
        {password === null ? (
          <Tooltip title="Reveal password">
            <span>
              <IconButton
                size="small"
                disabled={busy}
                aria-label={`Reveal the password for ${login.username}`}
                onClick={() => void reveal()}
              >
                {busy ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <Eye size={14} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <Button size="small" color="inherit" onClick={() => setPassword(null)}>
            Hide
          </Button>
        )}
      </Stack>
      {password !== null && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: "center", mt: 0.25 }}
        >
          <Typography
            variant="body2"
            aria-live="polite"
            sx={{ fontFamily: "monospace", color: "text.secondary" }}
          >
            {password}
          </Typography>
          <Tooltip title="Copy password">
            <IconButton
              size="small"
              aria-label={`Copy the password for ${login.username}`}
              onClick={() => {
                setError(null);
                void copyText(password).catch((e) => {
                  setError(e instanceof Error ? e.message : String(e));
                });
              }}
            >
              <Copy size={14} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
      {error !== null && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
}

function ThunderSentence({ thunderUrl }: { thunderUrl: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: "block" }}
    >
      Manage user accounts in{" "}
      <MuiLink
        href={thunderUsersConsoleHref(thunderUrl)}
        target="_blank"
        rel="noreferrer"
        variant="inherit"
        aria-label="Open Thunder Console to add or remove real accounts"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        Thunder Console
        <ExternalLink size={11} aria-hidden />
      </MuiLink>
    </Typography>
  );
}

/**
 * Sign-in facts for a live deployment. Parent mounts only when deploy is green.
 * Empty logins stay silent except for the Thunder Console link.
 */
export function SignInPanel({
  logins,
  thunderUrl,
  revealPassword,
  loadState = "ready",
}: {
  logins: readonly PublishedTestUser[];
  thunderUrl: string;
  revealPassword: (username: string) => Promise<string>;
  loadState?: "ready" | "pending" | "error";
}) {
  return (
    <Box>
      {loadState === "pending" && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Loading test users…
        </Typography>
      )}
      {loadState === "error" && (
        <Typography
          variant="caption"
          color="error"
          sx={{ display: "block", mb: 1 }}
        >
          Couldn&apos;t load test users.
        </Typography>
      )}
      {loadState === "ready" && logins.length > 0 && (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            Test users for agents on this environment
          </Typography>
          <Stack spacing={1} sx={{ mt: 1, mb: 1.5 }}>
            {logins.map((login) => (
              <LoginRow
                key={login.username}
                login={login}
                revealPassword={revealPassword}
              />
            ))}
          </Stack>
        </>
      )}
      <ThunderSentence thunderUrl={thunderUrl} />
    </Box>
  );
}

/**
 * Live Deploy wiring for SignInPanel. Mount only when deploy is green so the
 * roles GET does not run while the panel is hidden.
 */
export function ProjectSignInPanel({
  projectName,
}: {
  projectName: string;
}) {
  const live = useProjectRoles(projectName, true);
  const reveal = useRevealTestUserPassword(projectName);
  const loadState = live.isPending
    ? "pending"
    : live.isError
      ? "error"
      : "ready";
  const logins =
    loadState === "ready" ? publishedTestUsers(live.data?.testUsers ?? []) : [];

  return (
    <SignInPanel
      logins={logins}
      thunderUrl={env.thunderUrl}
      loadState={loadState}
      revealPassword={async (username) => {
        const data = await reveal.mutateAsync(username);
        return data.password;
      }}
    />
  );
}
