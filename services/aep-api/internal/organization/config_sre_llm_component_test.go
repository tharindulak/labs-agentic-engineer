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

// COMPONENT tier (docs/design/org-config-consolidation.md): the REAL
// organization.Service orchestrator over a REAL SreLlmConfigService, sharing
// ONE pristine dbtest Postgres + real AES-GCM store, with only the Anthropic
// probe faked at the HTTP boundary — mirrors config_component_test.go's tier,
// narrowed to the sreLlm section only (this file drives Service.Get/Patch
// directly rather than through the HTTP handler chain, since Task 6 wires the
// orchestrator, not the route layer).
//
// The DB rides along (real upserts ARE the service), so this file self-skips
// under -short like the other dbtest-tier files.
//
// External test package: an in-package dbtest file would be an import cycle
// (dbtest imports migrate, which imports organization), same as
// anthropic_dbtest_test.go / sre_llm_config_persist_dbtest_test.go.
package organization_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/internal/platform/orgconfig"
	"github.com/wso2/aep/aep-api/internal/platform/patch"
	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

func sreLlmOrchestratorService(t *testing.T, anthropicStatus int) *organization.Service {
	t.Helper()
	db := dbtest.New(t)
	store, err := secrets.NewDBStore(db, []byte(sreLlmDBAESKey))
	if err != nil {
		t.Fatalf("real DBStore: %v", err)
	}
	base, _ := organization.AnthropicFakeAPIExported(t, anthropicStatus)
	sreLlmSvc := organization.NewSreLlmConfigService(organization.NewPlatformSreLlmRepository(db), store).WithAnthropicAPIBase(base)

	svc := organization.NewService(
		nil, nil, nil, nil, nil,
		organization.PlatformIDPConfig{},
		"", "",
	).WithSreLlm(sreLlmSvc)
	return svc
}

func TestOrgConfigService_SreLlm_GetDefaultsToNil(t *testing.T) {
	t.Parallel()
	svc := sreLlmOrchestratorService(t, http.StatusOK)
	proj, err := svc.Get(context.Background(), "acme")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if proj.SreLLM != nil {
		t.Fatalf("sreLlm before any patch: want nil, got %+v", proj.SreLLM)
	}
}

func TestOrgConfigService_SreLlm_PatchSetThenGet(t *testing.T) {
	t.Parallel()
	svc := sreLlmOrchestratorService(t, http.StatusOK)
	ctx := context.Background()

	p := orgconfig.ConfigPatch{
		SreLLM: patch.Field[orgconfig.SreLlmWrite]{
			Sent: true,
			Value: orgconfig.SreLlmWrite{
				Provider: "anthropic", Model: "claude-sonnet-5", APIKey: sreLlmDBAnthropicKey,
			},
		},
	}
	proj, err := svc.Patch(ctx, "acme", "dev@acme.example", p)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if proj.SreLLM == nil || proj.SreLLM.Provider != "anthropic" || proj.SreLLM.Model != "claude-sonnet-5" {
		t.Fatalf("sreLlm after patch: %+v", proj.SreLLM)
	}

	again, err := svc.Get(ctx, "acme")
	if err != nil || again.SreLLM == nil || again.SreLLM.Provider != "anthropic" {
		t.Fatalf("get after patch: %+v err %v", again.SreLLM, err)
	}
}

func TestOrgConfigService_SreLlm_PatchRejectedKeyIsSectionError(t *testing.T) {
	t.Parallel()
	svc := sreLlmOrchestratorService(t, http.StatusUnauthorized)
	p := orgconfig.ConfigPatch{
		SreLLM: patch.Field[orgconfig.SreLlmWrite]{
			Sent: true,
			Value: orgconfig.SreLlmWrite{
				Provider: "anthropic", Model: "claude-sonnet-5", APIKey: sreLlmDBAnthropicKey,
			},
		},
	}
	_, err := svc.Patch(context.Background(), "acme", "dev@acme.example", p)
	var se *organization.SectionError
	if !errorsAsSectionError(err, &se) || se.Section != "sreLlm" || se.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want SectionError{sreLlm,422}, got %v", err)
	}
}

func TestOrgConfigService_SreLlm_PatchNullClears(t *testing.T) {
	t.Parallel()
	svc := sreLlmOrchestratorService(t, http.StatusOK)
	ctx := context.Background()
	set := orgconfig.ConfigPatch{SreLLM: patch.Field[orgconfig.SreLlmWrite]{Sent: true, Value: orgconfig.SreLlmWrite{
		Provider: "anthropic", Model: "claude-sonnet-5", APIKey: sreLlmDBAnthropicKey,
	}}}
	if _, err := svc.Patch(ctx, "acme", "dev@acme.example", set); err != nil {
		t.Fatalf("set patch: %v", err)
	}

	clear := orgconfig.ConfigPatch{SreLLM: patch.Field[orgconfig.SreLlmWrite]{Sent: true, Null: true}}
	proj, err := svc.Patch(ctx, "acme", "dev@acme.example", clear)
	if err != nil {
		t.Fatalf("clear patch: %v", err)
	}
	if proj.SreLLM != nil {
		t.Fatalf("sreLlm after null patch: want nil, got %+v", proj.SreLLM)
	}
}

// errorsAsSectionError keeps the test bodies' errors.As usage local without
// importing "errors" just for this: SectionError is an exported type in
// package organization, so a manual Unwrap walk works directly.
func errorsAsSectionError(err error, target **organization.SectionError) bool {
	for err != nil {
		if se, ok := err.(*organization.SectionError); ok {
			*target = se
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
