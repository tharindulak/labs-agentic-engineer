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

export { compileProject } from "./compiler/compileProject";
export { compileCellSource } from "./compiler/compileCellSource";
export { parseProject } from "./parser/parseProject";
export {
  MIXED_CELL_MODE_DIAGNOSTIC_CODE,
  MIXED_CELL_MODE_MESSAGE
} from "./parser/parseProject";
export { planMixedDslConversion } from "./parser/planMixedDslConversion";
export { DiagramCanvas } from "./renderer/DiagramCanvas";
export { fingerprintSource, parsePortableSource, serializePortableSource } from "./renderer/customLayout";
export { CellDiagram } from "./renderer/CellDiagram";

export type {
  ProjectModel,
  ProjectCompileResult,
  CellModel,
  CrossEdge,
  ExternalNode,
  ParsedComponent,
  ParsedExternal,
  ParsedEdge,
  Diagnostic,
  BoundaryDirection
} from "./domain/cellModel";
export type { CellDiagramProps } from "./renderer/CellDiagram";
export type { MixedDslConversion } from "./parser/planMixedDslConversion";
export type { CanvasMessage, DiagramCanvasProps, DiagramTheme } from "./renderer/DiagramCanvas";
export type { CustomLayout, CustomNodePosition, PortableCellSource } from "./renderer/customLayout";
