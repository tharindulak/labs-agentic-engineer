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

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusChip, type StatusTone } from "./StatusChip";

describe("StatusChip", () => {
  it.each([
    ["success", "MuiChip-colorSuccess"],
    ["info", "MuiChip-colorInfo"],
    ["warning", "MuiChip-colorWarning"],
    ["error", "MuiChip-colorError"],
    ["neutral", "MuiChip-colorDefault"],
    ["primary", "MuiChip-colorPrimary"],
  ] satisfies [StatusTone, string][])(
    "maps tone %s to the Oxygen Chip color class %s",
    (tone, className) => {
      render(<StatusChip label="Building" tone={tone} />);
      const chip = screen.getByText("Building").closest(".MuiChip-root");
      expect(chip).toHaveClass(className);
    },
  );

  it("renders the label as the chip's visible text", () => {
    render(<StatusChip label="On hold" tone="warning" />);
    expect(screen.getByText("On hold")).toBeInTheDocument();
  });

  it("defaults to the filled variant", () => {
    render(<StatusChip label="Done" tone="success" />);
    expect(screen.getByText("Done").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-filled",
    );
  });

  it("renders outlined when requested", () => {
    render(<StatusChip label="Mixed" tone="warning" variant="outlined" />);
    expect(screen.getByText("Mixed").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-outlined",
    );
  });
});
