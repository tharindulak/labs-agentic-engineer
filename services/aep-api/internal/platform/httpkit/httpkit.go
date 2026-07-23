// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

// Package httpkit holds the shared HTTP response primitives: the
// WriteErrorResponse JSON error writer (response.go) used across the edge
// layer, and the APIV1 version prefix the contract-first router mounts every
// operation under.
package httpkit

// APIV1 is the client-facing edge's version prefix, declared ONCE. The
// contract-first router mounts every public operation under it (it is the
// committed contract's `servers` base URL), and raw routes that need the
// absolute path (e.g. the GitHub OAuth redirect_uri) build on it directly.
// A v2 is a one-edit change here. The internal S2S surface uses a separate
// /internal/v1 root (api.internalV1).
const APIV1 = "/api/v1"
