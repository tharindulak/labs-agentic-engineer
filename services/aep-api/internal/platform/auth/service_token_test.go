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

package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServiceTokenMiddleware_MatchingBearerGoesStraightToOnMatch(t *testing.T) {
	cfg := ServiceTokenConfig{Token: "s3cr3t", OuHandle: "acme", ClientID: "sre-mcp-service"}
	var got *Claims
	var calledOnMatch, calledOnNoMatch bool
	onMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnMatch = true
		got = ClaimsFromContext(r.Context())
	})
	onNoMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnNoMatch = true
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p/issues", nil)
	req.Header.Set("Authorization", "Bearer s3cr3t")
	ServiceTokenMiddleware(cfg, onMatch, onNoMatch).ServeHTTP(httptest.NewRecorder(), req)

	if !calledOnMatch {
		t.Fatal("expected a matching bearer to go straight to onMatch")
	}
	if calledOnNoMatch {
		t.Fatal("expected a matching bearer to never reach onNoMatch (e.g. JWT verification)")
	}
	if got == nil || got.OuHandle != "acme" || got.ClientID != "sre-mcp-service" {
		t.Fatalf("expected claims stamped for acme/sre-mcp-service, got %+v", got)
	}
}

func TestServiceTokenMiddleware_WrongBearerFallsThroughToOnNoMatchUnclaimed(t *testing.T) {
	cfg := ServiceTokenConfig{Token: "s3cr3t", OuHandle: "acme", ClientID: "sre-mcp-service"}
	var got *Claims
	var calledOnMatch, calledOnNoMatch bool
	onMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnMatch = true
	})
	onNoMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnNoMatch = true
		got = ClaimsFromContext(r.Context())
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p/issues", nil)
	req.Header.Set("Authorization", "Bearer some-other-jwt")
	ServiceTokenMiddleware(cfg, onMatch, onNoMatch).ServeHTTP(httptest.NewRecorder(), req)

	if !calledOnNoMatch {
		t.Fatal("expected the request to still reach onNoMatch so normal JWT auth can run")
	}
	if calledOnMatch {
		t.Fatal("expected a non-matching bearer to never reach onMatch")
	}
	if got != nil {
		t.Fatalf("expected no claims stamped for a non-matching bearer, got %+v", got)
	}
}

func TestServiceTokenMiddleware_EmptyTokenDisablesThePath(t *testing.T) {
	cfg := ServiceTokenConfig{Token: "", OuHandle: "acme", ClientID: "sre-mcp-service"}
	var calledOnMatch, calledOnNoMatch bool
	onMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnMatch = true
	})
	onNoMatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calledOnNoMatch = true
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/p/issues", nil)
	req.Header.Set("Authorization", "Bearer anything")
	ServiceTokenMiddleware(cfg, onMatch, onNoMatch).ServeHTTP(httptest.NewRecorder(), req)

	if calledOnMatch {
		t.Fatal("expected an empty Token to disable this path entirely, onMatch must never run")
	}
	if !calledOnNoMatch {
		t.Fatal("expected an empty Token to route straight to onNoMatch, unconditionally")
	}
}

func TestIsSREMCPServiceCaller(t *testing.T) {
	ctx := WithClaims(context.Background(), &Claims{ClientID: "sre-mcp-service"})
	if !IsSREMCPServiceCaller(ctx, "sre-mcp-service") {
		t.Fatal("expected true for a matching ClientID")
	}
	if IsSREMCPServiceCaller(ctx, "something-else") {
		t.Fatal("expected false for a non-matching clientID argument")
	}
	if IsSREMCPServiceCaller(WithClaims(context.Background(), nil), "sre-mcp-service") {
		t.Fatal("expected false when no claims are present")
	}
}
