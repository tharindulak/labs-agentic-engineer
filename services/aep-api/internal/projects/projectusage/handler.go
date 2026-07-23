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

package projectusage

import (
	"context"

	"github.com/wso2/aep/aep-api/internal/gen"
)

// Handler serves get-project-usage. PLACEHOLDER until the #249 backend
// (capture, persistence, per-phase aggregation, USD derivation per ADR-0011)
// lands: no usage capture exists yet, so all-zero rollups are the truth —
// the console hides zero-usage chips.
type Handler struct{}

// New returns the slice's handler.
func New() *Handler { return &Handler{} }

func (h *Handler) GetProjectUsage(_ context.Context, _ gen.GetProjectUsageRequestObject) (gen.GetProjectUsageResponseObject, error) {
	zero := gen.Usage{} // zero tokens, "" model, null costUsd — nothing captured yet
	return gen.GetProjectUsage200JSONResponse(gen.ProjectUsage{
		Spec:       zero,
		Build:      zero,
		Validation: zero,
		DraftCycle: zero,
	}), nil
}
