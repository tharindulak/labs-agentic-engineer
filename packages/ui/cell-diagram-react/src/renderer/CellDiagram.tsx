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

import { useEffect, useMemo, type CSSProperties } from "react";
import { compileProject } from "../compiler/compileProject";
import type { Diagnostic, ProjectModel } from "../domain/cellModel";
import { DiagramCanvas, type DiagramTheme } from "./DiagramCanvas";
import type { CustomLayout } from "./customLayout";

export interface CellDiagramProps {
  /** Cell DSL source text; compiled internally. */
  source?: string;
  /** Pre-compiled model; used when `source` is not provided. */
  model?: ProjectModel;
  className?: string;
  style?: CSSProperties;
  /** Called with parse/compile diagnostics whenever `source` changes. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Light or dark color theme. Defaults to `"light"`. */
  theme?: DiagramTheme;
  /**
   * Best-effort compile: render the partial diagram from a still-incomplete
   * `source` (e.g. a streaming `design.cell`) instead of the error placeholder.
   */
  tolerant?: boolean;
  /**
   * Manually dragged node positions (see `captureCustomPosition`). Without a
   * round-trip through these two props a dragged node snaps back to the
   * auto-layout on drop.
   */
  customLayout?: CustomLayout | null;
  onCustomLayoutChange?: (layout: CustomLayout) => void;
}

export function CellDiagram({
  source,
  model,
  className,
  style,
  onDiagnostics,
  theme = "light",
  tolerant,
  customLayout,
  onCustomLayoutChange
}: CellDiagramProps) {
  const compiled = useMemo(
    () => (source !== undefined ? compileProject(source, { tolerant }) : null),
    [source, tolerant]
  );

  useEffect(() => {
    if (compiled) {
      onDiagnostics?.(compiled.diagnostics);
    }
  }, [compiled, onDiagnostics]);

  const resolvedModel = source !== undefined ? compiled?.model ?? null : model ?? null;

  return (
    <div className={className} style={{ width: "100%", height: "100%", ...style }}>
      <DiagramCanvas
        model={resolvedModel}
        theme={theme}
        source={source ?? ""}
        customLayout={customLayout}
        onCustomLayoutChange={onCustomLayoutChange}
      />
    </div>
  );
}
