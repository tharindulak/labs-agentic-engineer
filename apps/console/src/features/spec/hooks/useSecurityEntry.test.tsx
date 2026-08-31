/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SECURITY_JSON_PATH } from "../api/designTree";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useSecurityEntry } from "./useSecurityEntry";

const mockContent = vi.fn();
vi.mock("../api/queries", () => ({
  useSpecFileContent: (...args: unknown[]) => mockContent(...args),
}));

vi.mock("../api/roles", () => ({
  useProjectRoles: () => ({ data: undefined, isPending: false, isError: false }),
}));

const FILE = {
  path: SECURITY_JSON_PATH,
  sha: "abc",
  group: "designs",
} as SpecFileEntry;

function collab(hasLive: boolean): CollabSpec {
  return {
    peers: [],
    getFileText: (path: string) =>
      hasLive && path === SECURITY_JSON_PATH ? ({} as never) : null,
  } as unknown as CollabSpec;
}

vi.mock("../collab/useYTextString", () => ({
  useYTextString: (ytext: unknown) => (ytext ? '{"version":1}' : null),
}));

beforeEach(() => {
  mockContent.mockReset();
  mockContent.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  });
});

function run(over: {
  active?: boolean;
  agentInRoom?: boolean;
  live?: boolean;
} = {}) {
  return renderHook(() =>
    useSecurityEntry({
      projectName: "p",
      active: over.active ?? true,
      files: [FILE],
      collab: collab(over.live ?? false),
      agentInRoom: over.agentInRoom ?? false,
    }),
  ).result.current;
}

describe("useSecurityEntry — committed fallback loading", () => {
  it("reports pending only while the solo committed read is in flight", () => {
    mockContent.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    const entry = run();

    expect(mockContent).toHaveBeenLastCalledWith("p", FILE);
    expect(entry.isPending).toBe(true);
    expect(entry.isError).toBe(false);
    expect(entry.securityJson).toBeNull();
  });

  it("does not spin when the room already has the document (disabled query may still be pending)", () => {
    mockContent.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: true,
    });
    const entry = run({ live: true });

    expect(mockContent).toHaveBeenLastCalledWith("p", null);
    expect(entry.isPending).toBe(false);
    expect(entry.isError).toBe(false);
    expect(entry.securityJson).toBe('{"version":1}');
  });

  it("uses committed data.content on the solo path", () => {
    mockContent.mockReturnValue({
      data: { content: '{"version":1,"thunder":{"name":"orders-app","type":"browser"}}' },
      isPending: false,
      isError: false,
    });
    const entry = run();

    expect(mockContent).toHaveBeenLastCalledWith("p", FILE);
    expect(entry.isPending).toBe(false);
    expect(entry.isError).toBe(false);
    expect(entry.securityJson).toBe(
      '{"version":1,"thunder":{"name":"orders-app","type":"browser"}}',
    );
  });

  it("does not spin when an agent is in the room and the committed read is suppressed", () => {
    mockContent.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    const entry = run({ agentInRoom: true });

    expect(mockContent).toHaveBeenLastCalledWith("p", null);
    expect(entry.isPending).toBe(false);
  });

  it("surfaces a committed-read failure", () => {
    mockContent.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    const entry = run();

    expect(entry.isPending).toBe(false);
    expect(entry.isError).toBe(true);
  });
});
