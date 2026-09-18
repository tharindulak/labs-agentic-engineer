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

package createreport

import (
	"context"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/ops"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// validClassifications is the closed set the handoff agent may send.
var validClassifications = map[string]bool{
	"code-level":   true,
	"config-level": true,
	"mixed":        true,
	"none":         true,
}

// Handler serves create-rca-agent-report.
type Handler struct {
	reports ops.Repository
}

// New returns the slice's handler.
func New(reports ops.Repository) *Handler { return &Handler{reports: reports} }

// CreateRcaAgentReport validates and persists a new report.
//
// The caller is any userJWT holder scoped to the org — including a
// widened-audience service-account token; there is no separate service-auth
// scheme (BE handshake #156). The deny-by-default tenant gate binds the active
// org from the verified token before this runs, so org is read from the context
// and never from the request.
func (h *Handler) CreateRcaAgentReport(ctx context.Context, request gen.CreateRcaAgentReportRequestObject) (gen.CreateRcaAgentReportResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)

	report, err := toDomain(org, request.Body)
	if err != nil {
		return nil, apierr.BadRequest(err.Error())
	}
	if err := h.reports.Create(ctx, report); err != nil {
		return nil, apierr.Internal("failed to create rca-agent report")
	}
	return gen.CreateRcaAgentReport201JSONResponse(ops.ToWire(*report)), nil
}

// toDomain maps the wire body onto the domain entity.
//
// The body carries ONE thing: `report`, the SRE agent's own report document.
// Every column is derived from it here, which is why the agent needs no
// knowledge of this schema — it sends what it modelled and the side that owns
// the contract does the mapping. Validation lives here rather than in the schema
// because the 400 has to name fields of the REPORT to be actionable, and a
// schema error would name fields of this request instead.
func toDomain(org string, in *gen.CreateRcaAgentReportRequest) (*ops.RcaAgentReport, error) {
	if in == nil {
		return nil, fmt.Errorf("%w: request body is required", ops.ErrInvalidReport)
	}
	if len(in.Report) == 0 {
		return nil, fmt.Errorf("%w: report is required", ops.ErrInvalidReport)
	}
	return fromNative(org, in.Report)
}
