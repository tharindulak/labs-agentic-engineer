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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { ChatInput } from "./ChatInput";

function renderInput(props: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <ChatInput
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
        disabled={false}
        contextLabel="shop"
        {...props}
      />
    </OxygenUIThemeProvider>,
  );
  return { onSubmit, onChange };
}

afterEach(cleanup);

describe("ChatInput", () => {
  it("shows the project context label", () => {
    renderInput();
    expect(screen.getByText("shop")).toBeInTheDocument();
  });

  it("locks the composer with a hint while a teammate's turn runs", () => {
    renderInput({
      disabled: true,
      hint: "Agent is working on Sarah Perera's request…",
      value: "",
    });
    expect(screen.getByTestId("input-hint")).toHaveTextContent(
      "Agent is working on Sarah Perera's request…",
    );
    expect(screen.getByPlaceholderText("Waiting for the current turn…")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("submits on Enter when there is a draft", () => {
    const { onSubmit } = renderInput({ value: "add gift wrapping" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not submit on Shift+Enter (newline)", () => {
    const { onSubmit } = renderInput({ value: "line one" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables send when the draft is empty", () => {
    renderInput({ value: "   " });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});
