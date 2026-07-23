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

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { EllipsisVertical } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import type { DependencyResolutionIntent } from "../../projects/lib/dependencyResolutionMessage.js";

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildInputItem = components["schemas"]["BuildInputItem"];

/**
 * Per-group working state, keyed by DependencyGroup.key (#252 Task 15 — a
 * merged group's cross-component dedupe identity; a component-local
 * dependency's key is equivalent to its own `${component}::${dependency}`, so
 * this degrades to the pre-Task-15 per-item keying when nothing merges).
 * Only the input kinds (external-config / external-spec) carry state —
 * platform-resource and org-service are informational: clicking Continue is
 * the user's approval of every change listed, so there is no per-item toggle.
 */
type ItemState = {
  /** external-config: value typed per config key, keyed by key name. */
  values: Record<string, string>;
  /** external-spec: URL field. */
  specUrl: string;
  /** external-spec: pasted-content field. */
  specContent: string;
};

/**
 * Kinds computed by the shared resolver (models.ComputeDependencyStatus) that
 * have NO local form — the drawer can only surface the reason and hand off to
 * chat; there is nothing to type here that would resolve them (#252 Task 10,
 * restoring the proceed gate Task 1 orphaned). "external-spec" deliberately
 * stays OUT of this set: it keeps its own pre-existing local form (paste a
 * spec URL/content) below, so Continue can still be satisfied without chat.
 */
const BLOCKER_KINDS = new Set(["external-ambiguous", "external-unresolved"]);

function isBlockerKind(kind: PreflightItem["kind"]): boolean {
  return BLOCKER_KINDS.has(kind);
}

/**
 * #252 Task 15 — cross-component dependency dedupe key: two PreflightItems
 * are "the same shared dependency" when they carry the same `kind` AND the
 * same identity — `resourceType`+`dependency` name for a platform-resource
 * (the canonical case: `thunder-app` end-user auth, a platform resource
 * declared on both a web-application and its backing service), `dependency`
 * name alone for every other kind. Task 14 lifted the ComponentType!=service
 * preflight guard, so a project-scoped shared dependency now surfaces one
 * PreflightItem PER consuming component — this key is what re-collapses
 * those back into one card.
 */
function dependencyIdentity(item: PreflightItem): string {
  return item.kind === "platform-resource"
    ? `platform-resource:${item.resourceType ?? ""}:${item.dependency}`
    : `${item.kind}:${item.dependency}`;
}

/**
 * Order-independent signature of an external-config item's declared config
 * keys. Only `external-config` carries per-item, user-facing config that can
 * legitimately diverge between consumers (different env-var names/
 * descriptions/defaults) — every other kind either has no config
 * (org-service, the blocker kinds) or a platform-provisioned one
 * (platform-resource, e.g. thunder-app: outputs -> env, never user-entered),
 * so only this kind's entries are checked for divergence before merging.
 */
function configSignature(config: PreflightItem["config"]): string {
  return JSON.stringify(
    (config ?? [])
      .map((c) => ({
        key: c.key,
        secret: Boolean(c.secret),
        description: c.description ?? "",
        defaultValue: c.defaultValue ?? "",
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

function sameConfig(items: PreflightItem[]): boolean {
  const first = configSignature(items[0]?.config);
  return items.every((i) => configSignature(i.config) === first);
}

/**
 * One rendered card after cross-component grouping (#252 Task 15). `items`
 * holds every underlying PreflightItem the card represents — length 1 for a
 * component-local dependency, or when an `external-config` group's config
 * diverged across consumers (kept separate, not merged — the per-consumer
 * config grouping + collect-once-fan-out for DIVERGENT config is a
 * documented fast-follow, not this task). `representative` (the first item,
 * sorted by component) drives the type-specific form/gating; `usedBy` is the
 * sorted, deduped list of consuming components, rendered as the "Used by"
 * indicator only when it has 2+ entries.
 */
interface DependencyGroup {
  key: string;
  items: PreflightItem[];
  representative: PreflightItem;
  usedBy: string[];
}

/** Cross-component dedupe (#252 Task 15) — see dependencyIdentity/sameConfig above. */
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
    const canMerge =
      sorted.length === 1 ||
      sorted[0]!.kind !== "external-config" ||
      sameConfig(sorted);

    if (canMerge) {
      groups.push({
        key,
        items: sorted,
        representative: sorted[0]!,
        usedBy: [...new Set(sorted.map((i) => i.component))].sort(),
      });
    } else {
      // Divergent external-config: each consumer keeps its own card/form.
      for (const item of sorted) {
        groups.push({
          key: `${key}::${item.component}`,
          items: [item],
          representative: item,
          usedBy: [item.component],
        });
      }
    }
  }
  return groups;
}

/**
 * Initial typed values for an external-config item: a non-secret key with a
 * `defaultValue` renders pre-filled with it (a suggested region, base URL, …);
 * a secret key — or a key with no `defaultValue` — starts empty. A secret never
 * carries a default worth pre-filling (an API key has none), so we defensively
 * never seed one even if a stray `defaultValue` rides along.
 */
function seedValues(item?: PreflightItem): Record<string, string> {
  const values: Record<string, string> = {};
  if (item?.kind === "external-config") {
    for (const key of item.config ?? []) {
      values[key.key] = !key.secret ? (key.defaultValue ?? "") : "";
    }
  }
  return values;
}

/** Fresh per-item state as if the drawer just opened. */
function seedForItem(item?: PreflightItem): ItemState {
  return {
    values: seedValues(item),
    specUrl: "",
    specContent: "",
  };
}

// #252 Task 15: keyed by DependencyGroup.key, not per-raw-item — a merged
// group's config is collected ONCE and shared by every underlying item it
// represents (see handleContinue's fan-out below).
function initialState(groups: DependencyGroup[]): Record<string, ItemState> {
  const state: Record<string, ItemState> = {};
  for (const group of groups) {
    state[group.key] = seedForItem(group.representative);
  }
  return state;
}

/** True when this item's required input (if any) has been supplied. */
function isSatisfied(item: PreflightItem, state: ItemState): boolean {
  // A blocker item (ambiguous / needs-input) has no local form: it can ONLY
  // be cleared by resolving it via chat and the parent refetching preflight —
  // once resolved, it simply stops appearing in `items`. While it's present,
  // Continue must stay disabled, so this never reports satisfied locally.
  if (isBlockerKind(item.kind)) {
    return false;
  }
  if (item.kind === "external-config") {
    const keys = item.config ?? [];
    return keys.every((k) => (state.values[k.key] ?? "").trim() !== "");
  }
  if (item.kind === "external-spec") {
    return state.specUrl.trim() !== "" || state.specContent.trim() !== "";
  }
  // platform-resource / org-service are approvals, never a Continue blocker.
  return true;
}

// Only called for items the caller has already filtered to the kinds a
// BuildInputItem can represent (handleContinue drops blocker items first —
// they have no input to submit). Each branch's `kind` is a hardcoded literal
// (rather than reusing `item.kind`) so the return type stays exactly
// BuildInputItem["kind"], which no longer widens to include the
// PreflightItem-only blocker kinds (#252 Task 10).
function toBuildInputItem(
  item: PreflightItem,
  state: ItemState,
): BuildInputItem {
  const base = { component: item.component, dependency: item.dependency };

  if (item.kind === "external-config") {
    return {
      ...base,
      kind: "external-config",
      values: (item.config ?? []).map((k) => ({
        key: k.key,
        value: state.values[k.key] ?? "",
      })),
    };
  }

  if (item.kind === "external-spec") {
    return state.specUrl.trim() !== ""
      ? { ...base, kind: "external-spec", specUrl: state.specUrl }
      : { ...base, kind: "external-spec", specContent: state.specContent };
  }

  // platform-resource / org-service are informational — clicking Continue is
  // the approval, so they are always emitted approved.
  if (item.kind === "platform-resource") {
    return {
      ...base,
      kind: "platform-resource",
      approved: true,
      ...(item.parameters ? { parameters: item.parameters } : {}),
    };
  }

  // org-service (the only remaining reachable kind here).
  return { ...base, kind: "org-service", approved: true };
}

/**
 * The cross-component "Used by" indicator (#252 Task 15): rendered only for a
 * merged group (2+ consuming components) — a component-local dependency (the
 * common case) shows nothing extra.
 */
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

/**
 * #252 Task 17 — the resolved-dependency affordance: a small hamburger that
 * opens a one-item menu ("Discuss in chat & modify", the RECONSIDER intent).
 * Used by the panels whose dependency is already resolved at design time
 * (external-config — config values still to collect; platform-resource).
 * org-service never reaches this drawer in a resolved state — preflight's
 * orgServiceItems only emits a drawer item when the status is Unresolved /
 * Blocked / Ambiguous (services/aep-api/internal/feature/build/preflight.go)
 * — so it uses the BlockerPanel/ExternalSpecPanel's "Resolve via chat" button
 * (RESOLVE intent) instead. Never rendered alongside that button for the same
 * dependency.
 */
function DiscussInChatMenu({
  dependencyName,
  onClick,
}: {
  dependencyName: string;
  onClick: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        aria-label={`Actions for ${dependencyName}`}
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <EllipsisVertical size={16} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onClick();
          }}
        >
          Discuss in chat & modify
        </MenuItem>
      </Menu>
    </>
  );
}

/** Title row shared by the panels below: the dependency name, and — only
 * when the caller wired it — the "Discuss in chat & modify" hamburger. */
function PanelTitle({
  name,
  onDiscussInChat,
}: {
  name: string;
  onDiscussInChat?: (() => void) | undefined;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Typography variant="subtitle1">{name}</Typography>
      {onDiscussInChat && (
        <DiscussInChatMenu dependencyName={name} onClick={onDiscussInChat} />
      )}
    </Box>
  );
}

function ExternalConfigPanel({
  item,
  usedBy,
  state,
  onChange,
  onDiscussInChat,
}: {
  item: PreflightItem;
  usedBy: string[];
  state: ItemState;
  onChange: (key: string, value: string) => void;
  onDiscussInChat?: ((item: PreflightItem) => void) | undefined;
}) {
  return (
    <Stack spacing={2}>
      <PanelTitle
        name={item.dependency}
        onDiscussInChat={
          onDiscussInChat ? () => onDiscussInChat(item) : undefined
        }
      />
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      <UsedByLine usedBy={usedBy} />
      {(item.config ?? []).map((configKey) => (
        <TextField
          key={configKey.key}
          label={configKey.key}
          type={configKey.secret ? "password" : "text"}
          value={state.values[configKey.key] ?? ""}
          onChange={(e) => onChange(configKey.key, e.target.value)}
          helperText={configKey.description || undefined}
          fullWidth
          size="small"
        />
      ))}
    </Stack>
  );
}

function ExternalSpecPanel({
  item,
  usedBy,
  state,
  onUrlChange,
  onContentChange,
  onResolveViaChat,
}: {
  item: PreflightItem;
  usedBy: string[];
  state: ItemState;
  onUrlChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onResolveViaChat?: ((item: PreflightItem) => void) | undefined;
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">{item.dependency}</Typography>
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      <UsedByLine usedBy={usedBy} />
      <TextField
        label="Spec URL"
        value={state.specUrl}
        onChange={(e) => onUrlChange(e.target.value)}
        fullWidth
        size="small"
      />
      <Typography variant="caption" color="text.secondary">
        or paste the spec directly
      </Typography>
      <TextField
        label="Spec content"
        value={state.specContent}
        onChange={(e) => onContentChange(e.target.value)}
        multiline
        minRows={4}
        fullWidth
        size="small"
      />
      {onResolveViaChat ? (
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => onResolveViaChat(item)}
        >
          Resolve via chat
        </Button>
      ) : null}
    </Stack>
  );
}

/**
 * A blocker item raised from the shared resolver (ambiguous / needs-input):
 * no local form can satisfy it — only "Resolve via chat" (which seeds the
 * dependency-resolution turn; the parent refetches preflight when it ends, so
 * the item simply disappears from `items` once resolved).
 */
function BlockerPanel({
  item,
  usedBy,
  onResolveViaChat,
}: {
  item: PreflightItem;
  usedBy: string[];
  onResolveViaChat?: ((item: PreflightItem) => void) | undefined;
}) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1">{item.dependency}</Typography>
      <Typography variant="body2" color="text.secondary">
        {item.description}
      </Typography>
      <UsedByLine usedBy={usedBy} />
      {onResolveViaChat ? (
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => onResolveViaChat(item)}
        >
          Resolve via chat
        </Button>
      ) : null}
    </Stack>
  );
}

function InfoPanel({
  item,
  usedBy,
  kindLabel,
  detail,
  onDiscussInChat,
  onResolveViaChat,
}: {
  item: PreflightItem;
  usedBy: string[];
  // A short label shown right under the name (e.g. "Cross-project endpoint").
  kindLabel: string;
  // The full "what the platform will do" note — shown on hover of the label
  // rather than taking up a line in the drawer.
  detail: string;
  // Resolved dependency (platform-resource): the title-row hamburger →
  // "Discuss in chat & modify" (RECONSIDER intent).
  onDiscussInChat?: ((item: PreflightItem) => void) | undefined;
  // Non-resolved dependency (org-service — see the docblock above
  // DiscussInChatMenu): a "Resolve via chat" button (RESOLVE intent),
  // matching BlockerPanel/ExternalSpecPanel. Mutually exclusive with
  // onDiscussInChat for a given caller.
  onResolveViaChat?: ((item: PreflightItem) => void) | undefined;
}) {
  return (
    <Stack spacing={1}>
      <PanelTitle
        name={item.dependency}
        onDiscussInChat={
          onDiscussInChat ? () => onDiscussInChat(item) : undefined
        }
      />
      <UsedByLine usedBy={usedBy} />
      {/* The kind sits right under the name; the verbose action note is on
          hover (dotted underline hints it's interactive) instead of inline. */}
      <Tooltip title={detail}>
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{
            alignSelf: "flex-start",
            cursor: "help",
            borderBottom: "1px dotted",
            borderColor: "text.disabled",
          }}
        >
          {kindLabel}
        </Typography>
      </Tooltip>
      {/* The dependency's own description from the design, when the author
          gave one. Clamp to 3 lines so a long note doesn't blow out the
          drawer; the full text is available on hover. */}
      {item.description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          title={item.description}
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.description}
        </Typography>
      ) : null}
      {item.parameters ? (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            fontSize: "0.75rem",
            bgcolor: "action.hover",
            borderRadius: 1,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(item.parameters, null, 2)}
        </Box>
      ) : null}
      {onResolveViaChat ? (
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => onResolveViaChat(item)}
        >
          Resolve via chat
        </Button>
      ) : null}
    </Stack>
  );
}

export function BuildDependencyDrawer({
  open,
  items,
  onClose,
  onContinue,
  onResolveDependency,
  submitting = false,
}: {
  open: boolean;
  items: PreflightItem[];
  onClose: () => void;
  onContinue: (inputs: BuildInputItem[]) => void;
  // Fires the Task 5 seeded-message flow for one item (#252 Task 10/17):
  // "resolve" from the blocker/external-spec/org-service panels' "Resolve
  // via chat" button (a non-resolved dependency — org-service items never
  // reach this drawer resolved, see preflight.go's orgServiceItems);
  // "reconsider" from the external-config/platform-resource panels'
  // hamburger → "Discuss in chat & modify" (an already-resolved dependency
  // the user wants to revisit). Optional so a caller that hasn't wired chat
  // resolution yet (or a test) can omit it — the affordance simply doesn't
  // render.
  onResolveDependency?: (
    item: PreflightItem,
    intent: DependencyResolutionIntent,
  ) => void;
  // True while the parent's build call (POST /build) triggered by Continue is
  // in flight: the Continue button shows a spinner and both buttons disable so
  // the request can't be double-submitted or the drawer dismissed mid-call.
  // The parent closes the drawer on success.
  submitting?: boolean;
}) {
  // #252 Task 15: cross-component dedupe happens once per `items` change —
  // every kind-bucket / state lookup below iterates GROUPS, not raw items, so
  // a shared dependency declared on multiple components (thunder-app style)
  // renders as one card instead of one per consuming component.
  const groups = useMemo(() => groupPreflightItems(items), [items]);

  const [state, setState] = useState<Record<string, ItemState>>(() =>
    initialState(groups),
  );

  // Fresh state every time the drawer transitions to open, so a reopened
  // drawer never retains the prior session's typed values/toggles.
  useEffect(() => {
    if (open) {
      setState(initialState(groups));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canContinue = groups.every((group) => {
    const groupState = state[group.key];
    return groupState ? isSatisfied(group.representative, groupState) : false;
  });

  function updateState(group: DependencyGroup, patch: Partial<ItemState>) {
    setState((prev) => ({
      ...prev,
      [group.key]: {
        ...(prev[group.key] ?? seedForItem(group.representative)),
        ...patch,
      },
    }));
  }

  function handleContinue() {
    // Blocker groups (ambiguous / needs-input) are never representable as a
    // BuildInputItem — there is no input to submit for them, and Continue is
    // disabled while any are present anyway (isSatisfied always reports them
    // unsatisfied). Filtering defensively here, rather than trusting the
    // disabled button alone, keeps toBuildInputItem total over the kinds it
    // actually knows how to serialize. A merged group's ONE typed state fans
    // out to a BuildInputItem per underlying (component, dependency) pair —
    // the wire contract is unchanged, so the collect-once UI still submits
    // one input per original consumer.
    const inputs = groups
      .filter((group) => !isBlockerKind(group.representative.kind))
      .flatMap((group) => {
        const groupState = state[group.key] ?? seedForItem(group.representative);
        return group.items.map((item) => toBuildInputItem(item, groupState));
      });
    onContinue(inputs);
  }

  const externalConfigGroups = groups.filter(
    (g) => g.representative.kind === "external-config",
  );
  const externalSpecGroups = groups.filter(
    (g) => g.representative.kind === "external-spec",
  );
  const blockerGroups = groups.filter((g) => isBlockerKind(g.representative.kind));
  const platformResourceGroups = groups.filter(
    (g) => g.representative.kind === "platform-resource",
  );
  const orgServiceGroups = groups.filter(
    (g) => g.representative.kind === "org-service",
  );

  // #252 Task 17: the two fixed-intent wrappers each panel binds to its own
  // affordance — "Resolve via chat" (blocker/external-spec/org-service: a
  // non-resolved dependency) always fires "resolve"; the hamburger's
  // "Discuss in chat & modify" (external-config/platform-resource: an
  // already resolved dependency) always fires "reconsider". Both close
  // through the SAME onResolveDependency the parent wires (Task 15's
  // close-drawer-then-open-chat flow) — only the intent differs.
  const resolveViaChat = onResolveDependency
    ? (item: PreflightItem) => onResolveDependency(item, "resolve")
    : undefined;
  const discussInChat = onResolveDependency
    ? (item: PreflightItem) => onResolveDependency(item, "reconsider")
    : undefined;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Force an opaque surface: the theme's `background.paper` is itself
      // semi-transparent (#000000c5 ≈ 0.77 alpha) — a glass surface — so the
      // page behind bleeds through and the dependency text is hard to read.
      // `background.default` is the fully-opaque version of the same surface
      // (#000000 in dark / the light default), so it reads solid in both themes.
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
        <Typography variant="h6" sx={{ mb: 2 }}>
          Dependencies to resolve
        </Typography>

        {blockerGroups.length > 0 ? (
          <>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {blockerGroups.map((group) => (
                <BlockerPanel
                  key={group.key}
                  item={group.representative}
                  usedBy={group.usedBy}
                  onResolveViaChat={resolveViaChat}
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {externalConfigGroups.length > 0 ? (
          <>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {externalConfigGroups.map((group) => (
                <ExternalConfigPanel
                  key={group.key}
                  item={group.representative}
                  usedBy={group.usedBy}
                  state={state[group.key] ?? seedForItem(group.representative)}
                  onChange={(key, value) =>
                    updateState(group, {
                      values: {
                        ...(state[group.key] ?? seedForItem(group.representative))
                          .values,
                        [key]: value,
                      },
                    })
                  }
                  onDiscussInChat={discussInChat}
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {externalSpecGroups.length > 0 ? (
          <>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {externalSpecGroups.map((group) => (
                <ExternalSpecPanel
                  key={group.key}
                  item={group.representative}
                  usedBy={group.usedBy}
                  state={state[group.key] ?? seedForItem(group.representative)}
                  onUrlChange={(value) => updateState(group, { specUrl: value })}
                  onContentChange={(value) =>
                    updateState(group, { specContent: value })
                  }
                  onResolveViaChat={resolveViaChat}
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {platformResourceGroups.length > 0 ? (
          <>
            <Stack spacing={2} sx={{ mb: 3 }}>
              {platformResourceGroups.map((group) => (
                <InfoPanel
                  key={group.key}
                  item={group.representative}
                  usedBy={group.usedBy}
                  kindLabel={group.representative.resourceType ?? "Platform resource"}
                  detail={`We'll provision this ${group.representative.resourceType ?? "resource"} for you.`}
                  onDiscussInChat={discussInChat}
                />
              ))}
            </Stack>
            <Divider sx={{ mb: 3 }} />
          </>
        ) : null}

        {orgServiceGroups.length > 0 ? (
          <Stack spacing={2} sx={{ mb: 3 }}>
            {orgServiceGroups.map((group) => (
              <InfoPanel
                key={group.key}
                item={group.representative}
                usedBy={group.usedBy}
                kindLabel="Cross-project endpoint"
                detail="We'll publish this cross-project endpoint — it updates and rebuilds the owning project; your build continues, and the consuming task waits until it's published."
                onResolveViaChat={resolveViaChat}
              />
            ))}
          </Stack>
        ) : null}

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            loading={submitting}
            disabled={!canContinue || submitting}
            onClick={handleContinue}
          >
            Continue
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
