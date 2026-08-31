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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/renderer/diagram.css"), "utf8");

function ruleFor(selector: string) {
  const escaped = selector.replace(/[.#[\]]/g, (match) => `\\${match}`);
  const pattern = new RegExp(`${escaped} \\{[\\s\\S]*?\\}`);
  return styles.match(pattern)?.[0] ?? "";
}

const lightTokenBlock = styles.match(/:where\(\.cell-diagram-root\) \{[\s\S]*?\n\}/)?.[0] ?? "";
const darkTokenBlock =
  styles.match(/\.cell-diagram-root\[data-cd-theme="dark"\] \{[\s\S]*?\n\}/)?.[0] ?? "";

function themeTokensIn(block: string) {
  return new Set([...block.matchAll(/(--cd-[a-z-]+):/g)].map((match) => match[1]));
}

describe("diagram interaction styles", () => {
  it("does not resize nodes while highlighting connections", () => {
    const highlightRule = styles.match(/\.connection-highlight-node \.component-node,[\s\S]*?\}/)?.[0] ?? "";
    expect(highlightRule).not.toBe("");
    expect(highlightRule).not.toContain("transform:");
  });

  it("sizes component and boundary dependency subtype labels consistently", () => {
    const componentRule = ruleFor(".component-node small");
    const externalRule = ruleFor(".external-node small");

    expect(componentRule).toContain("font-size: 10px;");
    expect(componentRule).not.toContain("text-transform:");
    expect(externalRule).toContain("font-size: 10px;");
    expect(externalRule).not.toContain("text-transform:");
  });

  it("defines a coherent live-edit motion sequence", () => {
    expect(ruleFor(".diagram-node--position-animated")).toContain("transition: transform");
    expect(styles).toContain("@keyframes diagram-node-arrive");
    expect(styles).toContain("@keyframes diagram-edge-arrive");
    expect(styles).toContain("--diagram-edge-enter-delay: 80ms;");
  });

  // AEP divergence from upstream: without this exemption the layout transition
  // eases every pointer-move transform of the node being dragged, so it trails
  // and stutters instead of tracking the pointer.
  it("exempts the actively dragged node from the layout transition", () => {
    expect(ruleFor(".react-flow__node.dragging")).toContain("transition: none;");
  });

  it("visually distinguishes temporary layout state and disabled auto arrange", () => {
    expect(ruleFor(".canvas-notification")).toContain("position: absolute;");
    expect(ruleFor(".canvas-notification")).toContain("pointer-events: none;");
    expect(ruleFor('.canvas-notification[data-tone="warning"]')).toContain("var(--cd-warn-border)");
    expect(ruleFor('.canvas-notification[data-mode="message"]')).toContain("canvas-notification-pop");
    expect(ruleFor(".zoom-controls__auto:disabled")).toContain("cursor: not-allowed;");
  });

  it("keeps every rendered color behind a theme token", () => {
    expect(lightTokenBlock).not.toBe("");
    expect(darkTokenBlock).not.toBe("");

    const rules = styles.replace(lightTokenBlock, "").replace(darkTokenBlock, "");

    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
  });

  it("overrides every light token in the dark theme", () => {
    const lightTokens = themeTokensIn(lightTokenBlock);
    const darkTokens = themeTokensIn(darkTokenBlock);

    expect(lightTokens.size).toBeGreaterThan(0);
    const missing = [...lightTokens].filter((token) => !darkTokens.has(token));
    expect(missing).toEqual([]);
  });

  // The dark palette was Tailwind slate, and slate is a blue: against a
  // near-black app ground the canvas read as a navy slab sitting on the page
  // rather than as the card holding it. The greys are the part that has to
  // stay grey — the four boundary directions are exempt, since their hue is
  // what they mean.
  it("keeps the dark theme's greys off the blue axis", () => {
    // EVERY neutral in the dark block, not a sample of them: a tint that
    // creeps back into an untested token is exactly the regression this guards,
    // and the four boundary directions plus the warning pair are the only
    // tokens here whose hue is the thing they mean.
    const greys = [
      "--cd-canvas-bg",
      "--cd-surface",
      "--cd-surface-hover",
      "--cd-line",
      "--cd-line-strong",
      "--cd-dots",
      "--cd-node-border",
      "--cd-external-border",
      "--cd-edge",
      "--cd-title-text",
      "--cd-node-text",
      "--cd-body-text",
      "--cd-muted-text",
      "--cd-subtle-text",
      "--cd-disabled-text",
      "--cd-boundary-color",
      "--cd-info-text",
      "--cd-info-bg",
      "--cd-info-border",
      "--cd-hint-active-text",
    ];


    for (const token of greys) {
      const hex = darkTokenBlock.match(new RegExp(`${token}: (#[0-9a-f]{6});`))?.[1];
      expect(hex, `${token} should be a six-digit hex`).toBeDefined();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex!.slice(i, i + 2), 16));
      // 8/255 of spread is a tint you cannot name; slate's #0f172a spans 27.
      expect(
        Math.max(r, g, b) - Math.min(r, g, b),
        `${token} (${hex}) carries a visible hue`,
      ).toBeLessThanOrEqual(8);
    }
  });

  it("turns diagram construction motion off for reduced-motion users", () => {
    const reducedMotionRule = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(reducedMotionRule).toContain(".diagram-node--position-animated");
    expect(reducedMotionRule).toContain("transition: none;");
    expect(reducedMotionRule).toContain(".diagram-edge--entering .react-flow__edge-path");
    expect(reducedMotionRule).toContain("animation: none;");
  });
});
