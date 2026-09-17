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
	"crypto/subtle"
	"net/http"
)

// ServiceTokenConfig configures a single static, long-lived bearer credential
// that resolves directly to one org. It exists because the SRE-agent's
// generic MCP client config (mcp.json) is resolved once, when the agent
// process starts, and never refreshed mid-process — incompatible with the
// normal short-lived Thunder OAuth token a caller would otherwise refresh
// itself.
type ServiceTokenConfig struct {
	// Token is the expected bearer value (without the "Bearer " prefix).
	Token string
	// OuHandle is the org this credential always resolves to — one static
	// credential, one org, never a claim an attacker-controlled request body
	// could pick.
	OuHandle string
	// ClientID marks Claims stamped by this path so sreServiceScopeGate (see
	// edge/tenant_gate.go) can restrict it to its two allowed operations.
	ClientID string
}

// ServiceTokenMiddleware returns middleware that, on an exact constant-time
// bearer match, stamps Claims for cfg.OuHandle/cfg.ClientID and calls next
// with those claims already in context. Any other Authorization value (or no
// match) is passed to next completely unchanged, so normal user/service JWT
// auth downstream is unaffected — this is a narrow addition, not a
// replacement, for the existing verifier.
//
// A zero-value cfg (empty Token) disables this path entirely: the
// composition root leaves it disabled unless SRE_MCP_TOKEN is configured.
func ServiceTokenMiddleware(cfg ServiceTokenConfig, next http.Handler) http.Handler {
	if cfg.Token == "" {
		return next
	}
	expected := []byte("Bearer " + cfg.Token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented := []byte(r.Header.Get("Authorization"))
		if len(presented) == len(expected) && subtle.ConstantTimeCompare(presented, expected) == 1 {
			ctx := WithClaims(r.Context(), &Claims{ClientID: cfg.ClientID, OuHandle: cfg.OuHandle})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// IsSREMCPServiceCaller reports whether ctx's claims were stamped by
// ServiceTokenMiddleware for the given clientID, rather than by a real
// user/service JWT.
func IsSREMCPServiceCaller(ctx context.Context, clientID string) bool {
	if clientID == "" {
		return false
	}
	c := ClaimsFromContext(ctx)
	return c != nil && c.ClientID == clientID
}
