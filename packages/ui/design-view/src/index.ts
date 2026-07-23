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

export { DesignView } from "./DesignView.js";
export type {
  DependencyResolutionIntent,
  DesignViewProps,
  DependencyStatusInfo,
} from "./DesignView.js";
export { parseComponentDesign } from "./parse.js";
export type {
  ComponentDesign,
  Dependency,
  DependencyCandidate,
  DependencyKind,
  DesignConfigEntry,
  DesignEndpoint,
  ParseError,
  ParseResult,
} from "./parse.js";
