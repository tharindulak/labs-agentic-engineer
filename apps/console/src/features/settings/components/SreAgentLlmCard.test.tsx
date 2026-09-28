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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";

const setMutate = vi.fn();
const clearMutate = vi.fn();

vi.mock("../api/queries", () => ({
  useSetSreLlm: () => ({
    mutate: setMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useClearSreLlm: () => ({
    mutate: clearMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const { SreAgentLlmCard } = await import("./SreAgentLlmCard");

type SreLlm = Parameters<typeof SreAgentLlmCard>[0]["sreLlm"];

const sreLlmSet: NonNullable<SreLlm> = {
  provider: "openai",
  model: "gpt-4o-mini",
  keyPrefix: "sk-test-abcd",
  keyLast4: "wxyz",
  status: "active",
  connectedAt: "2026-08-06T09:41:00Z",
};

function renderCard(sreLlm: SreLlm) {
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <SreAgentLlmCard sreLlm={sreLlm} />
    </OxygenUIThemeProvider>,
  );
}

const modelSelect = () => screen.getByRole("combobox", { name: "Model" });

// The provider/model fields are MUI Selects (a combobox + listbox, not a
// native <select>), so picking a value is mouseDown-to-open then click-the-
// option — matching CodingAgentCard.test.tsx's convention for the same kind
// of field, rather than firing a native "change" event a Select has no
// listener for.
function chooseModel(label: string) {
  fireEvent.mouseDown(modelSelect());
  fireEvent.click(screen.getByRole("option", { name: label }));
}

beforeEach(() => {
  setMutate.mockClear();
  clearMutate.mockClear();
});
afterEach(cleanup);

describe("SreAgentLlmCard", () => {
  it("shows not-connected with no config set", () => {
    renderCard(null);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/sk-test-abcd/)).not.toBeInTheDocument();
  });

  it("shows the connected provider, model, and key preview", () => {
    renderCard(sreLlmSet);
    expect(screen.getByText("openai · gpt-4o-mini")).toBeInTheDocument();
    expect(modelSelect()).toHaveTextContent("GPT-4o mini");
    expect(screen.getByText(/sk-test-abcd/)).toBeInTheDocument();
    expect(screen.getByText(/wxyz/)).toBeInTheDocument();
  });

  it("keeps save disabled until provider, model, and key are all filled", () => {
    renderCard(null);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
    chooseModel("GPT-4o mini");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: "sk-test-typed" } });
    expect(save).toBeEnabled();
  });

  it("submits provider, model, and key together", () => {
    renderCard(null);
    chooseModel("GPT-4o mini");
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: "sk-test-typed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(setMutate).toHaveBeenCalledWith(
      { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-typed" },
      expect.anything(),
    );
  });

  it("disconnect calls clear", () => {
    renderCard(sreLlmSet);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /disconnect/i }));
    expect(clearMutate).toHaveBeenCalledOnce();
  });
});
