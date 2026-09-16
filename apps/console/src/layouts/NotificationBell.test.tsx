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

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionIssue } from "../features/issues/api/queries";

const toggleNotificationPanel = vi.fn();
vi.mock("@wso2/oxygen-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wso2/oxygen-ui")>();
  return {
    ...actual,
    useAppShell: () => ({
      state: { notificationPanelOpen: true },
      actions: { toggleNotificationPanel },
    }),
  };
});

let mockItems: AttentionIssue[] = [];
let mockPending = false;
let mockFailedCount = 0;
vi.mock("../features/issues/api/queries", () => ({
  useAttentionIssues: () => ({
    isPending: mockPending,
    items: mockItems,
    failedCount: mockFailedCount,
  }),
}));

import { AlertsNotificationPanel, NotificationButton } from "./NotificationBell";

const issue = (over: Partial<AttentionIssue> = {}): AttentionIssue => ({
  project: "demo-shop",
  number: 12,
  title: "checkout-service: apply discount before tax",
  url: "https://github.com/acme/demo-shop/issues/12",
  reason: "escalated",
  ...over,
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  mockItems = [];
  mockPending = false;
  mockFailedCount = 0;
  toggleNotificationPanel.mockClear();
});

describe("NotificationButton", () => {
  it("badges the count of unseen attention issues", () => {
    mockItems = [issue({ number: 1 }), issue({ number: 2 })];
    render(<NotificationButton />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("toggles the panel and marks everything seen on click", () => {
    mockItems = [issue()];
    render(<NotificationButton />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(toggleNotificationPanel).toHaveBeenCalled();
  });
});

describe("AlertsNotificationPanel", () => {
  it("shows each attention issue's title and reason", () => {
    mockItems = [issue({ reason: "no_change_verdict" })];
    render(<AlertsNotificationPanel />);
    expect(
      screen.getByText("checkout-service: apply discount before tax"),
    ).toBeInTheDocument();
    expect(screen.getByText(/No change needed/)).toBeInTheDocument();
  });

  it("opens the issue's GitHub URL, not a console route", () => {
    mockItems = [issue()];
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<AlertsNotificationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/acme/demo-shop/issues/12",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
