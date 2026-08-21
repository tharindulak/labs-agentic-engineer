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

// Makes the validation run's deployed endpoints usable, and proves they answer,
// before the agent starts.
//
// Two different problems, both of which used to be the agent's:
//
//  1. `*.localhost` is unreachable from the two clients that matter. curl (>=7.77)
//     and Chromium both implement RFC 6761: they resolve `localhost` and every
//     `*.localhost` name to loopback THEMSELVES, consulting neither DNS nor
//     `/etc/hosts`. On a local plane every deployed endpoint is
//     `*.openchoreoapis.localhost`, so inside the runner pod both dial 127.0.0.1
//     — where nothing listens — however healthy the deployment is. The cluster's
//     CoreDNS rewrite is correct and simply never gets asked. Node is NOT
//     affected (`dns.lookup` returns the real address), which is why the probe
//     below needs no override of its own.
//
//     The fix is a `resolve` entry per endpoint in curl's own config file, so a
//     plain `curl <url>` works with the real hostname, through the real gateway,
//     carrying the real Host header the HTTPRoute matches on. Rewriting the URL
//     was the alternative and is worse: an IP in the URL sends `Host: <ip>` and
//     matches no route, and a Service-DNS URL bypasses the gateway altogether —
//     dropping the api-configuration trait's auth, CORS and path rewrites, so an
//     auth-gated criterion could pass through a side door.
//
//  2. Whether the deployment answers at all is a PLATFORM fact. It used to be a
//     `curl` in the aep-validation skill with prose telling the agent to stop if
//     it failed; the agent did not stop — it read RFC 6761's connection refused
//     as a broken deployment and went hunting through the pod's DNS
//     configuration. Same reasoning, and the same shape, as the context fetch in
//     validation_context.ts: an unanswerable platform question never reaches the
//     agent.
//
// On a cloud plane the endpoints are real DNS names, nothing special-cases them,
// and `curlResolveEntries` returns nothing — so no config is written and the
// whole local-plane concession costs the cloud path exactly nothing.

import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ComponentEndpoint } from "./validation_context.js";

/** curl's per-user config file, read from `$CURL_HOME` then `$HOME`. */
export const CURL_CONFIG_FILE = ".curlrc";

/**
 * Where the config goes, and what `CURL_HOME` is set to in the agent's env.
 *
 * One function so the writer and the env record cannot drift — a config written
 * somewhere curl is not told to look is indistinguishable from no config at all.
 *
 * The home directory, deliberately: it is outside the git work tree, so unlike
 * `.aep/` there is no path by which this file could be committed, and it is not
 * world-writable, so the staged-rename below is guarding against far less than
 * it would under /tmp.
 */
export function curlConfigHome(): string {
  return os.homedir();
}

/** One `resolve = host:port:address` override. */
export interface CurlResolveEntry {
  host: string;
  port: number;
  address: string;
}

/** An endpoint that did not answer, and what stopped it. */
export interface UnreachableEndpoint {
  component: string;
  url: string;
  reason: string;
}

/** The lookup shape used here — `dns.promises.lookup`'s options overload. */
type LookupFn = (host: string, options: { family: 4 }) => Promise<{ address: string }>;

/**
 * How long a single probe may take. Generous on purpose: this runs once per
 * endpoint on a cold gateway, and a false "unreachable" costs a whole validation
 * cycle, while a slow one costs seconds.
 */
const PROBE_TIMEOUT_MS = 10_000;

/** The port a URL implies when it does not name one. */
function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

/**
 * Which endpoints need a curl override, and what address to pin them to.
 *
 * Only `.localhost` hosts qualify — that is the exact set RFC 6761 captures, and
 * pinning anything else would freeze a name curl already resolves correctly (and
 * would go stale the moment the address changed). DNS is the discovery channel:
 * the CoreDNS rewrite answers any `*.openchoreoapis.localhost` with the
 * data-plane gateway's address, so the answer is resolved per run rather than
 * configured — a baked-in IP passes once and then silently points at nothing.
 *
 * Forgiving by design. An unparseable URL or a name that will not resolve is
 * warned about and skipped, never thrown: `probeEndpoints` is what decides
 * whether the run may proceed, and it reports the endpoint that actually failed
 * rather than the lookup that preceded it.
 */
export async function curlResolveEntries(
  endpoints: readonly ComponentEndpoint[],
  lookup: LookupFn = dns.promises.lookup as LookupFn,
  log: (line: string) => void = () => {},
): Promise<CurlResolveEntry[]> {
  const entries: CurlResolveEntry[] = [];
  // Components can share a gateway host:port, and a duplicate `resolve` line is
  // noise in a file a human may well have to read.
  const seen = new Set<string>();

  for (const ep of endpoints) {
    let parsed: URL;
    try {
      parsed = new URL(ep.url);
    } catch {
      log(`[endpoints] ⚠️  ${ep.component}: not a URL, no curl override written: ${ep.url}`);
      continue;
    }
    if (!parsed.hostname.endsWith(".localhost")) {
      continue;
    }
    const port = parsed.port === "" ? defaultPort(parsed.protocol) : Number(parsed.port);
    const key = `${parsed.hostname}:${port}`;
    if (seen.has(key)) {
      continue;
    }
    try {
      const { address } = await lookup(parsed.hostname, { family: 4 });
      seen.add(key);
      entries.push({ host: parsed.hostname, port, address });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[endpoints] ⚠️  ${ep.component}: cannot resolve ${parsed.hostname}: ${msg}`);
    }
  }
  return entries;
}

/**
 * Write the overrides to `<dir>/.curlrc`, or nothing when there are none.
 *
 * Staged in a private directory and renamed into place, for the same reasons
 * validation_context.ts stages its write: `mode` is honoured only on create, so
 * writing over an existing path would keep whatever permissions it already had,
 * and rename is atomic and does not follow a symlink at the destination.
 *
 * Returns the path written, or undefined when there was nothing to write — an
 * empty file would be indistinguishable from a run whose endpoints needed no
 * override, and callers log the difference.
 */
export async function writeCurlResolveConfig(
  dir: string,
  entries: readonly CurlResolveEntry[],
): Promise<string | undefined> {
  if (entries.length === 0) {
    return undefined;
  }
  const file = path.join(dir, CURL_CONFIG_FILE);
  const body =
    `# Written by the AEP validation runner. Deployed endpoints are\n` +
    `# *.openchoreoapis.localhost, which curl resolves to loopback itself\n` +
    `# (RFC 6761) — these pin them to the gateway DNS actually answers with.\n` +
    entries.map((e) => `resolve = ${e.host}:${e.port}:${e.address}`).join("\n") +
    `\n`;

  await fs.promises.mkdir(dir, { recursive: true });
  const staging = await fs.promises.mkdtemp(path.join(dir, ".aep-curlrc-"));
  try {
    const staged = path.join(staging, CURL_CONFIG_FILE);
    await fs.promises.writeFile(staged, body, { mode: 0o600 });
    await fs.promises.rename(staged, file);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
  return file;
}

/**
 * Probe every endpoint and report the ones that did not answer.
 *
 * ANY HTTP response counts as reachable — status is deliberately not evidence.
 * An endpoint behind the api-configuration trait legitimately answers 401, an
 * API root legitimately answers 404, and a gateway holding no matching
 * HTTPRoute also answers 404, indistinguishably from the app's own. Reading a
 * status as a verdict would therefore manufacture failures against healthy
 * deployments, which is the exact fault this preflight exists to remove. Only a
 * transport failure — refused, unroutable, timed out, unresolvable — means the
 * platform cannot show the agent the system it is meant to validate.
 *
 * Redirects are NOT followed. A login redirect points at the IdP on the control
 * plane, which is a different hop with its own resolution story; chasing it here
 * would turn an answered endpoint into a false negative. A 302 is an answer.
 */
export async function probeEndpoints(
  endpoints: readonly ComponentEndpoint[],
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<UnreachableEndpoint[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const unreachable: UnreachableEndpoint[] = [];

  for (const ep of endpoints) {
    try {
      const res = await doFetch(ep.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Nothing here reads the body; leaving it unconsumed holds the socket.
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      const reason = cause?.code ?? (err instanceof Error ? err.message : String(err));
      unreachable.push({ component: ep.component, url: ep.url, reason });
    }
  }
  return unreachable;
}
