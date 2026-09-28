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

package organization

// UNIT tier: SreLlmConfigService's provider-branching validation with no DB,
// both providers' probes faked at the HTTP boundary. Mirrors
// anthropic_service_test.go's structure and reuses anthropicFakeAPI (same
// package) for the Anthropic branch.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

const sreLlmUnitAnthropicKey = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234"
const sreLlmUnitOpenAIKey = "sk-test-abcdefghijklmnopqrstuvwx"

// openaiFakeAPI serves the /v1/models probe with a fixed status and captures
// the last request's auth header — the OpenAI-side sibling of anthropicFakeAPI.
func openaiFakeAPI(t testing.TB, status int) (string, *anthropicProbeCapture) {
	t.Helper()
	rec := &anthropicProbeCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.calls++
		rec.method, rec.path = r.Method, r.URL.Path
		rec.apiKey = r.Header.Get("Authorization")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, rec
}

func TestSreLlmValidateKey_UnknownProviderRejected(t *testing.T) {
	t.Parallel()
	svc := NewSreLlmConfigService(nil, nil)
	err := svc.ValidateKey(context.Background(), "cohere", "some-key")
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Code != "sre_llm_provider_invalid" {
		t.Fatalf("want ValidationError{sre_llm_provider_invalid}, got %v", err)
	}
}

func TestSreLlmValidateKey_EmptyKeyRejected(t *testing.T) {
	t.Parallel()
	svc := NewSreLlmConfigService(nil, nil)
	err := svc.ValidateKey(context.Background(), "anthropic", "   ")
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Code != "sre_llm_key_missing" {
		t.Fatalf("want ValidationError{sre_llm_key_missing}, got %v", err)
	}
}

func TestSreLlmValidateKey_AnthropicProbe(t *testing.T) {
	t.Parallel()
	base, rec := anthropicFakeAPI(t, http.StatusOK)
	svc := NewSreLlmConfigService(nil, nil).WithAnthropicAPIBase(base)
	if err := svc.ValidateKey(context.Background(), "anthropic", sreLlmUnitAnthropicKey); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if rec.calls != 1 || rec.method != http.MethodPost || rec.path != "/v1/messages" {
		t.Fatalf("anthropic probe shape: %+v", rec)
	}
}

func TestSreLlmValidateKey_AnthropicRejected(t *testing.T) {
	t.Parallel()
	base, _ := anthropicFakeAPI(t, http.StatusUnauthorized)
	svc := NewSreLlmConfigService(nil, nil).WithAnthropicAPIBase(base)
	err := svc.ValidateKey(context.Background(), "anthropic", sreLlmUnitAnthropicKey)
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Code != "sre_llm_key_invalid" {
		t.Fatalf("want ValidationError{sre_llm_key_invalid}, got %v", err)
	}
}

func TestSreLlmValidateKey_OpenAIProbe(t *testing.T) {
	t.Parallel()
	base, rec := openaiFakeAPI(t, http.StatusOK)
	svc := NewSreLlmConfigService(nil, nil).WithOpenAIAPIBase(base)
	if err := svc.ValidateKey(context.Background(), "openai", sreLlmUnitOpenAIKey); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if rec.calls != 1 || rec.method != http.MethodGet || rec.path != "/v1/models" {
		t.Fatalf("openai probe shape: %+v", rec)
	}
	if rec.apiKey != "Bearer "+sreLlmUnitOpenAIKey {
		t.Fatalf("openai auth header: got %q", rec.apiKey)
	}
}

func TestSreLlmValidateKey_OpenAIRejected(t *testing.T) {
	t.Parallel()
	base, _ := openaiFakeAPI(t, http.StatusUnauthorized)
	svc := NewSreLlmConfigService(nil, nil).WithOpenAIAPIBase(base)
	err := svc.ValidateKey(context.Background(), "openai", sreLlmUnitOpenAIKey)
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Code != "sre_llm_key_invalid" {
		t.Fatalf("want ValidationError{sre_llm_key_invalid}, got %v", err)
	}
}

func TestSreLlmValidateKey_UpstreamServerErrorIs502(t *testing.T) {
	t.Parallel()
	for _, provider := range []string{"anthropic", "openai"} {
		provider := provider
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			svc := NewSreLlmConfigService(nil, nil)
			var base string
			if provider == "anthropic" {
				base, _ = anthropicFakeAPI(t, http.StatusServiceUnavailable)
				svc = svc.WithAnthropicAPIBase(base)
			} else {
				base, _ = openaiFakeAPI(t, http.StatusServiceUnavailable)
				svc = svc.WithOpenAIAPIBase(base)
			}
			err := svc.ValidateKey(context.Background(), provider, sreLlmUnitAnthropicKey)
			var ue *UpstreamError
			if !errors.As(err, &ue) {
				t.Fatalf("%s upstream 503 must yield *UpstreamError, got %T: %v", provider, err, err)
			}
		})
	}
}
