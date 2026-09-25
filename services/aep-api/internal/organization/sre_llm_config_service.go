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

// sre_llm_config_service.go — the SRE agent's platform-wide LLM config
// service. Unlike AnthropicCredentialService this holds exactly ONE row
// (platform_sre_llm_config, id=1) with no org/role dimension: the SRE agent
// is a single shared pod, not dispatched per-org. See
// docs/superpowers/specs/2026-09-23-sre-agent-llm-key-design.md.
package organization

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

// sreLlmPlatformOrgID is the CredentialStore sentinel org id for this
// config's secret bytes — the store requires a non-empty, validated
// ocOrgID, and this has no real org. Distinct from the reserved "_platform".
const sreLlmPlatformOrgID = "platform"

// sreLlmSecretStoreKey is the org_secrets key holding the encrypted key
// bytes under the sentinel org above.
const sreLlmSecretStoreKey = "sre-llm/api-key"

// SreLlmConfigService owns the SRE agent's platform-wide LLM config.
type SreLlmConfigService struct {
	repo  PlatformSreLlmRepository
	store secrets.CredentialStore

	anthropicAPI string
	openaiAPI    string
	httpClient   *http.Client

	secretRefWriter *SecretRefWriter
}

// NewSreLlmConfigService wires the service. repo and store must be non-nil
// for anything beyond ValidateKey (tests exercising only validation pass nil
// for both, exactly like anthropic_service_test.go does).
func NewSreLlmConfigService(repo PlatformSreLlmRepository, store secrets.CredentialStore) *SreLlmConfigService {
	return &SreLlmConfigService{
		repo:         repo,
		store:        store,
		anthropicAPI: "https://api.anthropic.com",
		openaiAPI:    "https://api.openai.com",
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// WithAnthropicAPIBase overrides the Anthropic validation probe's base URL;
// chainable. Test seam — see WithAnthropicAPIBase on AnthropicCredentialService.
func (s *SreLlmConfigService) WithAnthropicAPIBase(base string) *SreLlmConfigService {
	s.anthropicAPI = base
	return s
}

// WithOpenAIAPIBase overrides the OpenAI validation probe's base URL; chainable.
func (s *SreLlmConfigService) WithOpenAIAPIBase(base string) *SreLlmConfigService {
	s.openaiAPI = base
	return s
}

// WithSecretRefWriter injects the SM-API mirror writer; chainable. nil-safe.
func (s *SreLlmConfigService) WithSecretRefWriter(w *SecretRefWriter) *SreLlmConfigService {
	s.secretRefWriter = w
	return s
}

// ValidateKey runs connect-time validation without persisting anything: the
// provider must be a known member, the key must be non-empty, and the key
// must pass a live probe against the chosen provider's API. This is the
// probe-only seam the /config PATCH orchestrator's probe phase calls, same
// role as AnthropicCredentialService.ValidateKey.
func (s *SreLlmConfigService) ValidateKey(ctx context.Context, provider, apiKey string) error {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return &ValidationError{Code: "sre_llm_key_missing", Message: "apiKey is required"}
	}
	switch provider {
	case "anthropic":
		return s.validateAnthropic(ctx, key)
	case "openai":
		return s.validateOpenAI(ctx, key)
	default:
		return &ValidationError{Code: "sre_llm_provider_invalid", Message: "provider must be 'anthropic' or 'openai'"}
	}
}

// validateAnthropic mirrors AnthropicCredentialService.validateAnthropicKey's
// probe shape exactly (same headers, same status-code triage) — kept as a
// separate copy rather than a shared helper because the two services'
// error codes are deliberately namespaced differently (anthropic_* vs
// sre_llm_*) so a client can tell which section rejected a key.
func (s *SreLlmConfigService) validateAnthropic(ctx context.Context, key string) error {
	body := []byte(`{
	  "model": "claude-haiku-4-5",
	  "max_tokens": 1,
	  "messages": [{"role":"user","content":"ping"}]
	}`)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.anthropicAPI+"/v1/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return &ValidationError{Code: "sre_llm_unreachable", Message: fmt.Sprintf("Anthropic API unreachable: %v", err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return &ValidationError{Code: "sre_llm_key_invalid", Message: "Anthropic rejected the key (401 Unauthorized)"}
	case http.StatusForbidden:
		return &ValidationError{Code: "sre_llm_key_forbidden", Message: "Anthropic key lacks the required permissions"}
	case http.StatusOK, http.StatusBadRequest:
		return nil
	}
	if resp.StatusCode >= 500 {
		return &UpstreamError{Code: "sre_llm_unavailable", Message: fmt.Sprintf("Anthropic API returned %d: %s", resp.StatusCode, truncateForError(respBody))}
	}
	return &ValidationError{Code: "sre_llm_unexpected_status", Message: fmt.Sprintf("Anthropic API returned %d: %s", resp.StatusCode, truncateForError(respBody))}
}

// validateOpenAI probes GET /v1/models — a minimal authenticated read every
// valid OpenAI key can make, with the same status-code triage as the
// Anthropic branch.
func (s *SreLlmConfigService) validateOpenAI(ctx context.Context, key string) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.openaiAPI+"/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+key)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return &ValidationError{Code: "sre_llm_unreachable", Message: fmt.Sprintf("OpenAI API unreachable: %v", err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return &ValidationError{Code: "sre_llm_key_invalid", Message: "OpenAI rejected the key (401 Unauthorized)"}
	case http.StatusForbidden:
		return &ValidationError{Code: "sre_llm_key_forbidden", Message: "OpenAI key lacks the required permissions"}
	case http.StatusOK:
		return nil
	}
	if resp.StatusCode >= 500 {
		return &UpstreamError{Code: "sre_llm_unavailable", Message: fmt.Sprintf("OpenAI API returned %d: %s", resp.StatusCode, truncateForError(respBody))}
	}
	return &ValidationError{Code: "sre_llm_unexpected_status", Message: fmt.Sprintf("OpenAI API returned %d: %s", resp.StatusCode, truncateForError(respBody))}
}

// sreLlmKeyPreview returns the same prefix+last4 display shape
// anthropicKeyPreview uses, generalized to not assume a "sk-ant-" prefix.
func sreLlmKeyPreview(k string) (prefix, last4 string) {
	if len(k) < 8 {
		return k, ""
	}
	cut := len(k) / 2
	if cut > 15 {
		cut = 15
	}
	prefix = k[:cut]
	last4 = k[len(k)-4:]
	return
}

// Set validates the key, persists it, and mirrors it via SecretRefWriter
// when configured. org is the calling admin's org from the /config request
// context — passed through only so SecretRefWriter.WriteSreLlm has a JWT
// context to compute a vault path from; the row itself carries no org
// column, and which admin happened to be active is otherwise inert (the
// resulting path is what gets stored and later read back).
//
// The SecretRefWriter mirror is best-effort, same posture as
// AnthropicCredentialService.Connect's own mirror call: org_secrets stays
// authoritative when SM-API is unavailable, so a mirror failure is logged
// and swallowed rather than failing the Set call.
func (s *SreLlmConfigService) Set(ctx context.Context, org, provider, model, apiKey string) (*SreLlmConfig, error) {
	key := strings.TrimSpace(apiKey)
	if err := s.ValidateKey(ctx, provider, key); err != nil {
		return nil, err
	}
	if strings.TrimSpace(model) == "" {
		return nil, &ValidationError{Code: "sre_llm_model_missing", Message: "model is required"}
	}

	now := time.Now().UTC()
	prefix, last4 := sreLlmKeyPreview(key)
	row := &PlatformSreLlmConfig{
		Provider: provider, Model: model,
		KeyPrefix: prefix, KeyLast4: last4,
		Status: "active", ConnectedAt: now, LastValidatedAt: &now,
	}

	if err := s.store.Put(ctx, sreLlmPlatformOrgID, sreLlmSecretStoreKey, []byte(key)); err != nil {
		return nil, fmt.Errorf("sre-llm set: store put: %w", err)
	}
	if err := s.repo.Upsert(ctx, row); err != nil {
		return nil, fmt.Errorf("sre-llm set: upsert: %w", err)
	}

	// Best-effort SM-API mirror. Same posture as
	// AnthropicCredentialService.Connect's mirror call: org_secrets stays
	// authoritative when SM-API is unavailable; the row's SM-API triplet
	// stays NULL until the next successful Set.
	if s.secretRefWriter != nil && s.secretRefWriter.Enabled() {
		if _, err := s.secretRefWriter.WriteSreLlm(ctx, org, key); err != nil {
			slog.WarnContext(ctx, "sre-llm: SM-API mirror failed (legacy store still authoritative)",
				"org", org, "error", err)
		}
	}

	slog.InfoContext(ctx, "sre_llm.set", "provider", provider, "model", model, "keyPrefix", prefix)
	return projectionFromSreLlmRow(row), nil
}

// Get returns the current config, or nil when nothing has been set.
func (s *SreLlmConfigService) Get(ctx context.Context) (*SreLlmConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return projectionFromSreLlmRow(row), nil
}

// Clear removes the config and its stored secret. Idempotent.
func (s *SreLlmConfigService) Clear(ctx context.Context) error {
	if err := s.repo.Delete(ctx); err != nil {
		return fmt.Errorf("sre-llm clear: delete row: %w", err)
	}
	if err := s.store.Delete(ctx, sreLlmPlatformOrgID, sreLlmSecretStoreKey); err != nil {
		slog.WarnContext(ctx, "sre-llm: store delete failed", "error", err)
	}
	slog.InfoContext(ctx, "sre_llm.cleared")
	return nil
}

// SreLlmConfig is the service-level projection — deliberately its own type
// (not orgconfig.SreLlmProjection) so this package doesn't import orgconfig
// (orgconfig is the leaf that imports FROM domain packages' wire shapes are
// mapped INTO it, same direction as AnthropicProjection/llmProjectionFrom).
type SreLlmConfig struct {
	Provider        string
	Model           string
	KeyPrefix       string
	KeyLast4        string
	Status          string
	ConnectedAt     time.Time
	LastValidatedAt *time.Time
	ValidationError *string
}

func projectionFromSreLlmRow(r *PlatformSreLlmConfig) *SreLlmConfig {
	return &SreLlmConfig{
		Provider: r.Provider, Model: r.Model,
		KeyPrefix: r.KeyPrefix, KeyLast4: r.KeyLast4,
		Status: r.Status, ConnectedAt: r.ConnectedAt,
		LastValidatedAt: r.LastValidatedAt, ValidationError: r.ValidationError,
	}
}
