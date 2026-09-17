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

package edge

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/contracttest"
	"github.com/wso2/aep/aep-api/internal/platform/httpkit"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// TestTenantGateCarveOuts_NameContractOperations is the arch-lock on the
// enumerated carve-out set: every key must be a method of the generated
// strict interface (i.e. a real contract operationID). A contract rename or
// removal that orphans a carve-out fails here instead of silently leaving a
// dead entry that looks like an un-gated operation.
func TestTenantGateCarveOuts_NameContractOperations(t *testing.T) {
	t.Parallel()
	iface := reflect.TypeOf((*gen.StrictServerInterface)(nil)).Elem()
	for op := range tenantGateCarveOuts {
		if _, ok := iface.MethodByName(op); !ok {
			t.Errorf("carve-out %q is not an operation of the generated strict interface", op)
		}
	}
	// The set is deliberately tiny; growing it is a security decision. Force
	// the diff (and this comment) into any PR that adds one.
	if len(tenantGateCarveOuts) != 1 {
		t.Errorf("carve-out set changed size (%d) — review deny-by-default posture", len(tenantGateCarveOuts))
	}
}

// TestNoClientSuppliedOrg is the IDOR arch-lock, contract edition (successor
// of the retired *_huma.go tag scan): the active org is derived SOLELY from
// the verified JWT — the committed contract must never declare a parameter
// that would let a request name an org. Re-adding one would reintroduce the
// IDOR class the token-only model closed.
func TestNoClientSuppliedOrg(t *testing.T) {
	t.Parallel()
	banned := []string{"orgHandle", "orgId", "organizationId"}
	raw := contracttest.SourceYAML(t)
	for _, name := range banned {
		if bytes.Contains(raw, []byte("name: "+name)) {
			t.Errorf("contract declares a client-supplied org parameter %q", name)
		}
	}
}

// TestTenantGate_DenyByDefault unit-tests the strict middleware itself:
// claimless requests are denied 401 in ENFORCE, pass with a canary in LOG,
// carve-outs bypass entirely, and a token org is bound into the context the
// handler sees.
func TestTenantGate_DenyByDefault(t *testing.T) {
	t.Parallel()

	seen := ""
	next := func(ctx context.Context, _ http.ResponseWriter, _ *http.Request, _ any) (any, error) {
		seen = tenant.BoundOrgFromContext(ctx)
		return "ok", nil
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)

	t.Run("claimless ENFORCE → 401 apiError", func(t *testing.T) {
		ctx := tenant.WithGateMode(context.Background(), tenant.GateModeEnforce)
		_, err := tenantGate(next, "ListProjects")(ctx, nil, req, nil)
		var ae *apiError
		if !errors.As(err, &ae) || ae.Status != http.StatusUnauthorized {
			t.Fatalf("want 401 apiError, got %v", err)
		}
	})

	t.Run("claimless LOG → passes unbound", func(t *testing.T) {
		seen = "sentinel"
		ctx := tenant.WithGateMode(context.Background(), tenant.GateModeLog)
		if _, err := tenantGate(next, "ListProjects")(ctx, nil, req, nil); err != nil {
			t.Fatalf("LOG mode must pass through, got %v", err)
		}
		if seen != "" {
			t.Fatalf("LOG pass-through must not bind an org, got %q", seen)
		}
	})

	t.Run("token org → bound into handler ctx", func(t *testing.T) {
		ctx := auth.WithClaims(context.Background(), &auth.Claims{OuHandle: "acme"})
		if _, err := tenantGate(next, "ListProjects")(ctx, nil, req, nil); err != nil {
			t.Fatalf("authed call: %v", err)
		}
		if seen != "acme" {
			t.Fatalf("bound org: got %q want acme", seen)
		}
	})

	t.Run("carve-out bypasses the gate", func(t *testing.T) {
		seen = "sentinel"
		ctx := tenant.WithGateMode(context.Background(), tenant.GateModeEnforce)
		if _, err := tenantGate(next, "ListOrganizations")(ctx, nil, req, nil); err != nil {
			t.Fatalf("carve-out must not be denied, got %v", err)
		}
	})
}

// TestSREServiceScopeGate_AllowsOnlyItsTwoOperations unit-tests
// sreServiceScopeGate in isolation: the SRE-MCP static service credential
// (identified by its stamped ClientID) may call CreateIssue/ListIssues only —
// every other operationID is rejected before the wrapped handler ever runs,
// so a leaked long-lived token cannot reach the rest of the org-scoped API.
func TestSREServiceScopeGate_AllowsOnlyItsTwoOperations(t *testing.T) {
	t.Parallel()
	const clientID = "sre-mcp-service"

	calledFor := map[string]bool{}
	f := func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		calledFor["called"] = true
		return nil, nil
	}

	ctx := auth.WithClaims(context.Background(), &auth.Claims{ClientID: clientID})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p/issues", nil)

	for _, op := range []string{"CreateIssue", "ListIssues"} {
		calledFor["called"] = false
		_, err := sreServiceScopeGate(f, op)(ctx, httptest.NewRecorder(), req, nil)
		if err != nil || !calledFor["called"] {
			t.Fatalf("expected op %q to be allowed for this credential, err=%v called=%v", op, err, calledFor["called"])
		}
	}

	calledFor["called"] = false
	_, err := sreServiceScopeGate(f, "ListOrganizations")(ctx, httptest.NewRecorder(), req, nil)
	if err == nil {
		t.Fatal("expected a non-issues operation to be rejected for this credential")
	}
	if calledFor["called"] {
		t.Fatal("the wrapped handler must not run for a rejected operation")
	}
}

// TestSREServiceScopeGate_PassesThroughForOrdinaryCallers confirms the gate
// is a no-op for every ordinary (JWT-authenticated, non-service-token)
// caller — it must never restrict operations for a real user/service JWT.
func TestSREServiceScopeGate_PassesThroughForOrdinaryCallers(t *testing.T) {
	t.Parallel()
	f := func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		return "ok", nil
	}
	ctx := auth.WithClaims(context.Background(), &auth.Claims{OuHandle: "acme"}) // no ClientID set
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p/issues", nil)

	got, err := sreServiceScopeGate(f, "SomeUnrelatedOperation")(ctx, httptest.NewRecorder(), req, nil)
	if err != nil || got != "ok" {
		t.Fatalf("expected an ordinary (non-service-token) caller to pass through unaffected, got %v, %v", got, err)
	}
}

// TestSREMCPServiceToken_ComposedSlice_HTTPRoundTrip is the component-level
// regression test for the ACTUAL composed slice newAPIV1Handler wires onto
// the public edge — []gen.StrictMiddlewareFunc{tenantGate, sreServiceScopeGate}
// (surfaces.go/tenant_gate.go don't call either gate directly; this slice
// literal is the only wiring point). The two gate-level unit tests above
// (TestSREServiceScopeGate_*) call sreServiceScopeGate in isolation and would
// stay green even if server.go stopped composing it at all — nothing else
// pins the slice itself. This test builds the REAL mounted handler
// (NewHandler → mountSurfaces → newAPIV1Handler, InboundAuth left nil so the
// production ServiceTokenMiddleware→JWT chain from surfaces.go is exercised,
// not a test seam) with a configured SREMCPToken, and drives it over an
// actual HTTP round trip:
//
//   - the SRE-MCP bearer against ListIssues (one of sreMCPAllowedOps) must
//     NOT be rejected by the auth/scope layer. sourcecontrol is deliberately
//     left unwired, so a 503 from the absent issue service is the expected
//     PASSING outcome — it proves the request cleared both gates and reached
//     the real handler, which is as far as this test needs to go (the brief
//     doesn't require the business logic to succeed, only that auth let it
//     through).
//   - the SAME bearer against ListOrganizations must be rejected.
//     ListOrganizations is a deliberately adversarial target: it is ALSO
//     tenantGate's own carve-out (tenantGateCarveOuts), so tenantGate alone
//     would wave it through with no org claim at all. Only sreServiceScopeGate
//     stops it — so this branch fails the moment that gate is dropped from
//     server.go's slice (down to []gen.StrictMiddlewareFunc{tenantGate}), and
//     equally fails if the credential's ClientID stops being threaded through
//     to it end to end.
func TestSREMCPServiceToken_ComposedSlice_HTTPRoundTrip(t *testing.T) {
	t.Parallel()
	const token = "sre-mcp-test-token"
	const org = "acme"

	handler := NewHandler(AppParams{
		SREMCPToken:     token,
		SREMCPOrgHandle: org,
	})

	bearerReq := func(method, path string) *http.Request {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		return req
	}

	t.Run("allowed op clears both gates", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, bearerReq(http.MethodGet, httpkit.APIV1+"/projects/demo/issues"))

		if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
			t.Fatalf("ListIssues: SRE credential rejected by the auth/scope layer, status=%d body=%s",
				rec.Code, rec.Body.String())
		}
		// sourcecontrol is intentionally unwired here (zero Deps): 503 from the
		// absent issue service is the expected outcome once past the gates.
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("ListIssues: status=%d body=%s, want 503 (unwired issue service) once past the gates",
				rec.Code, rec.Body.String())
		}
	})

	t.Run("disallowed op — tenantGate's own carve-out — is still rejected", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, bearerReq(http.MethodGet, httpkit.APIV1+"/organizations"))

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("ListOrganizations: status=%d body=%s, want 401 — sreServiceScopeGate must reject this "+
				"credential even though tenantGate carves the op out for every other caller",
				rec.Code, rec.Body.String())
		}
	})
}
