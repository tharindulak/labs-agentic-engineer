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

/**
 * Adoption decides whether a coding agent starts automatically against
 * production code. It defaults ON because the alternative is a silent dead end,
 * and only an explicit `false` turns it off — a typo must not quietly stop every
 * handover.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { boolEnv } from "./env.js";

test("only an explicit false disables an on-by-default switch", () => {
  assert.equal(boolEnv(undefined, true), true);
  assert.equal(boolEnv("", true), true);
  assert.equal(boolEnv("nonsense", true), true);
  assert.equal(boolEnv("false", true), false);
  assert.equal(boolEnv("FALSE", true), false);
  assert.equal(boolEnv(" false ", true), false);
  assert.equal(boolEnv("true", false), true);
});
