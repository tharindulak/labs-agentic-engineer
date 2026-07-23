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
import { describe, expect, it, vi } from "vitest";
import { NotFound } from "./NotFound";

// --- Router: only `Link` is used, and only its `to`/rendering behaviour
// matters here — stand it in for a plain anchor. -------------------------
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("NotFound", () => {
  it("renders a styled 404 with a way back to Projects", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Back to Projects" });
    expect(link).toHaveAttribute("href", "/");
  });
});
