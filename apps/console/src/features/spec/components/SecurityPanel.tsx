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
 * Spec → Security: one scroll over `security.json` — thunder, roles & users,
 * and standing rules. Read-only; the design agent writes the document in chat.
 */

import { useMemo, type ReactNode } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";

import type { ProjectRolesLiveState } from "../api/roles";
import {
  parseSecurityDesign,
  plannedUsersFor,
  type SecurityDesign,
} from "../api/securityDesign";

export interface SecurityPanelProps {
  /** Live `security.json` text — from the room, or the committed fallback. */
  securityJson: string | null;
  live?: ProjectRolesLiveState | undefined;
  /** Committed-blob read in flight — same spinner as Architecture / Wireframes. */
  isPending?: boolean;
  /** Committed-blob read failed. */
  isError?: boolean;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </Box>
  );
}

export function SecurityPanel({
  securityJson,
  live,
  isPending = false,
  isError = false,
}: SecurityPanelProps) {
  const parsed = useMemo(() => parseSecurityDesign(securityJson), [securityJson]);

  if (isPending) {
    return (
      <Centered>
        <CircularProgress aria-label="Loading security" />
      </Centered>
    );
  }
  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load the Security document.</Alert>
      </Box>
    );
  }

  if (parsed.kind === "empty") {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          This Security document is empty or incomplete. Ask in chat — the design
          agent can finish it.
        </Alert>
      </Box>
    );
  }
  if (parsed.kind === "invalid") {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Couldn&apos;t read the Security document: {parsed.message}
        </Alert>
      </Box>
    );
  }

  const { doc } = parsed;
  return (
    <Box sx={{ p: 3, overflow: "auto", height: "100%" }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            Security
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Who can sign in, what each role may do, and the Thunder application
            that issues the session.
          </Typography>
        </Box>
        <ThunderBlock doc={doc} />
        <RolesIntro />
        <DisposableWarning />
        {doc.roles.map((role) => (
          <RoleCard key={role.name} doc={doc} role={role} live={live} />
        ))}
        <StandingRules doc={doc} />
      </Stack>
    </Box>
  );
}

function DisposableWarning() {
  return (
    <Alert severity="warning">
      <AlertTitle>
        Disposable accounts for agents, not for real people
      </AlertTitle>
      Each role gets a test user so the validation agent can sign in and check
      what that role can actually do. Usernames live here; passwords are shown
      on Deploy after Build publishes them — never name a real person.
    </Alert>
  );
}

function ThunderBlock({ doc }: { doc: SecurityDesign }) {
  const scopes = doc.thunder.scopes?.trim();
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {doc.thunder.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        People sign in through this Thunder application. The platform creates
        it at Build. Callback URLs are bound when the app is deployed — they
        are not part of this document.
      </Typography>
      <Stack spacing={0.5}>
        <Typography variant="body2">Type: {doc.thunder.type}</Typography>
        <Typography variant="body2">
          {scopes
            ? `Scopes: ${scopes}`
            : "Scopes: platform default (openid profile email group ou)"}
        </Typography>
      </Stack>
    </Box>
  );
}

function RolesIntro() {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Roles &amp; users
      </Typography>
      <Typography variant="body2" color="text.secondary">
        These roles are created on the platform identity provider when you
        click Build — the same directory every project shares, so a role
        another project already uses is reused rather than duplicated.
      </Typography>
    </Box>
  );
}

function RoleCard({
  doc,
  role,
  live,
}: {
  doc: SecurityDesign;
  role: SecurityDesign["roles"][number];
  live: ProjectRolesLiveState | undefined;
}) {
  const liveRole = live?.roles.find(
    (r) => r.name.toLowerCase() === role.name.toLowerCase(),
  );
  const status = !live?.directoryAvailable
    ? null
    : !liveRole
      ? {
          label: "New at Build",
          color: "info" as const,
          why: "This role does not exist yet — Build creates it.",
        }
      : liveRole.platformCreated
        ? {
            label: "Reused",
            color: "success" as const,
            why: "Already on the identity provider, created by the platform.",
          }
        : {
            label: "Not ours",
            color: "warning" as const,
            why: "This group already exists and the platform did not create it, so it will be left alone.",
          };
  const planned = plannedUsersFor(doc, role.name);

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {role.name}
        </Typography>
        {status && (
          <Tooltip title={status.why}>
            <Chip size="small" color={status.color} label={status.label} />
          </Tooltip>
        )}
        {(liveRole?.memberCount ?? 0) > 0 && (
          <Typography variant="caption" color="text.secondary">
            {liveRole?.memberCount}{" "}
            {liveRole?.memberCount === 1 ? "member" : "members"}
          </Typography>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {role.description}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 1.5 }}
      >
        Granted by {role.grantedBy}
      </Typography>
      <Stack spacing={0.25} sx={{ mb: 1.5 }}>
        {role.permissions.map((p, i) => (
          <Typography key={`${p.component}:${i}`} variant="body2">
            <Box component="span" sx={{ fontFamily: "monospace" }}>
              {p.component}
            </Box>
            {" — "}
            {[...(p.actions ?? []), ...(p.screens ?? [])].join(", ")}
          </Typography>
        ))}
      </Stack>
      <Divider sx={{ mb: 1 }} />
      <Typography variant="overline" color="text.secondary">
        Test users
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {planned.map((u) => (
          <Stack
            key={u.username}
            direction="row"
            spacing={1}
            alignItems="center"
          >
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {u.username}
            </Typography>
            {u.supplied && (
              <Tooltip title="You didn't name a test user for this role, so the platform will use this name.">
                <Chip
                  size="small"
                  variant="outlined"
                  label="Platform-supplied"
                />
              </Tooltip>
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function StandingRules({ doc }: { doc: SecurityDesign }) {
  return (
    <Stack spacing={1}>
      {doc.coldStartRole !== null ? (
        <Typography variant="body2" color="text.secondary">
          A person who has just signed in and been granted nothing holds{" "}
          <strong>{doc.coldStartRole}</strong>.
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          A person who has just signed in and been granted nothing reaches
          nothing.
        </Typography>
      )}
      {doc.publicComponents.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Open to everyone, no sign-in: {doc.publicComponents.join(", ")}.
        </Typography>
      )}
    </Stack>
  );
}
