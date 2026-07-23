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

import { describe, expect, it } from "vitest";
import { isActiveStatus, taskChip } from "./status";

describe("taskChip", () => {
  it("gives on_hold its own distinct chip (#164 follow-up)", () => {
    expect(taskChip("on_hold")).toEqual({ label: "On hold", tone: "warning" });
  });

  it("keeps pending as its own chip, distinct from on_hold", () => {
    expect(taskChip("pending")).toEqual({ label: "Pending", tone: "neutral" });
  });

  it("falls back to an error chip with the raw status for unknown values", () => {
    expect(taskChip("???")).toEqual({ label: "???", tone: "error" });
  });
});

describe("isActiveStatus", () => {
  it("treats on_hold the same as pending — both are live, non-terminal", () => {
    expect(isActiveStatus("pending")).toBe(true);
    expect(isActiveStatus("on_hold")).toBe(true);
  });

  it("treats terminal statuses as inactive", () => {
    expect(isActiveStatus("deployed")).toBe(false);
    expect(isActiveStatus("failed")).toBe(false);
  });
});
