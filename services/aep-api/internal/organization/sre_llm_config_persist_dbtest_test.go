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

package organization_test

// DBTEST tier (skips under -short; `make test-db` runs it): SreLlmConfigService's
// Set/Get/Clear over a pristine per-test Postgres (dbtest.New) with the REAL
// AES-256-GCM secrets.NewDBStore — mirrors anthropic_dbtest_test.go's shape for
// the platform-wide singleton service.
//
// External test package: an in-package dbtest file would be an import cycle
// (dbtest imports migrate, which imports organization), same as
// anthropic_dbtest_test.go.

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

const sreLlmDBAESKey = "0123456789abcdef0123456789abcdef"
const sreLlmDBAnthropicKey = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234"
const sreLlmDBOpenAIKey = "sk-test-abcdefghijklmnopqrstuvwx"

func sreLlmDBService(t *testing.T, anthropicStatus, openaiStatus int) (*organization.SreLlmConfigService, secrets.CredentialStore) {
	t.Helper()
	db := dbtest.New(t)
	store, err := secrets.NewDBStore(db, []byte(sreLlmDBAESKey))
	if err != nil {
		t.Fatalf("real DBStore: %v", err)
	}
	svc := organization.NewSreLlmConfigService(organization.NewPlatformSreLlmRepository(db), store)
	if anthropicStatus != 0 {
		base, _ := organization.AnthropicFakeAPIExported(t, anthropicStatus)
		svc = svc.WithAnthropicAPIBase(base)
	}
	if openaiStatus != 0 {
		base, _ := organization.OpenAIFakeAPIExported(t, openaiStatus)
		svc = svc.WithOpenAIAPIBase(base)
	}
	return svc, store
}

func TestSreLlmSet_HappyPath_DB(t *testing.T) {
	t.Parallel()
	svc, store := sreLlmDBService(t, http.StatusOK, 0)
	ctx := context.Background()

	proj, err := svc.Set(ctx, "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey)
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if proj.Provider != "anthropic" || proj.Model != "claude-sonnet-5" {
		t.Fatalf("projection: %+v", proj)
	}

	got, err := store.Get(ctx, "platform", "sre-llm/api-key")
	if err != nil || string(got) != sreLlmDBAnthropicKey {
		t.Fatalf("stored key: got %q err %v", string(got), err)
	}

	read, err := svc.Get(ctx)
	if err != nil || read == nil || read.Provider != "anthropic" {
		t.Fatalf("get after set: %+v err %v", read, err)
	}
}

func TestSreLlmSet_SwitchProviderReplacesSingleton_DB(t *testing.T) {
	t.Parallel()
	svc, store := sreLlmDBService(t, http.StatusOK, http.StatusOK)
	ctx := context.Background()

	if _, err := svc.Set(ctx, "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey); err != nil {
		t.Fatalf("first set: %v", err)
	}
	proj, err := svc.Set(ctx, "acme", "openai", "gpt-4o-mini", sreLlmDBOpenAIKey)
	if err != nil {
		t.Fatalf("second set: %v", err)
	}
	if proj.Provider != "openai" || proj.Model != "gpt-4o-mini" {
		t.Fatalf("projection after switch: %+v", proj)
	}
	got, err := store.Get(ctx, "platform", "sre-llm/api-key")
	if err != nil || string(got) != sreLlmDBOpenAIKey {
		t.Fatalf("stored key after switch: got %q err %v, want the openai key", string(got), err)
	}
}

func TestSreLlmSet_RejectedKeyLeavesNoTrace_DB(t *testing.T) {
	t.Parallel()
	svc, store := sreLlmDBService(t, http.StatusUnauthorized, 0)
	ctx := context.Background()

	_, err := svc.Set(ctx, "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey)
	var ve *organization.ValidationError
	if !errors.As(err, &ve) || ve.Code != "sre_llm_key_invalid" {
		t.Fatalf("want ValidationError{sre_llm_key_invalid}, got %v", err)
	}
	read, err := svc.Get(ctx)
	if err != nil || read != nil {
		t.Fatalf("get after rejected set: want nil, got %+v err %v", read, err)
	}
	if _, err := store.Get(ctx, "platform", "sre-llm/api-key"); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("store after rejected set: want ErrSecretNotFound, got %v", err)
	}
}

// TestSreLlmSet_SecretRefWriterWiring_DB pins the Task-5 expanded-scope
// wiring: Set calls SecretRefWriter.WriteSreLlm (best-effort mirror) after
// the row is upserted when a writer is attached and enabled, and is a
// harmless no-op — Set still succeeds — when no writer is attached at all
// (the common case today, since Task 6 wires the composition root).
func TestSreLlmSet_SecretRefWriterWiring_DB(t *testing.T) {
	t.Parallel()

	t.Run("attached and enabled: WriteSreLlm is called after upsert and stamps the triplet", func(t *testing.T) {
		t.Parallel()
		db := dbtest.New(t)
		store, err := secrets.NewDBStore(db, []byte(sreLlmDBAESKey))
		if err != nil {
			t.Fatalf("real DBStore: %v", err)
		}
		repo := organization.NewPlatformSreLlmRepository(db)
		fake := &fakeSMClient{createRef: "sre-llm-secrets"}
		writer := organization.NewSecretRefWriter(fake, nil, nil, nil).WithPlatformSreLlm(repo)

		anthropicBase, _ := organization.AnthropicFakeAPIExported(t, http.StatusOK)
		svc := organization.NewSreLlmConfigService(repo, store).
			WithAnthropicAPIBase(anthropicBase).
			WithSecretRefWriter(writer)

		ctx := claimsCtx("ou-acme-uuid")
		if _, err := svc.Set(ctx, "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey); err != nil {
			t.Fatalf("set: %v", err)
		}

		if len(fake.createCalls) != 1 {
			t.Fatalf("want exactly 1 CreateSecret call (the sre-llm mirror), got %d", len(fake.createCalls))
		}
		call := fake.createCalls[0]
		wantLoc := secretmanagersvc.SecretLocation{OrgName: "ou-acme-uuid", ControlPlaneNamespace: "acme", EntityName: "sre-llm", SecretKey: secretmanagersvc.SecretKeyAPIKey}
		if call.loc != wantLoc {
			t.Fatalf("SecretLocation = %+v; want %+v", call.loc, wantLoc)
		}

		row, err := repo.Get(ctx)
		if err != nil || row == nil {
			t.Fatalf("reload: %+v err %v", row, err)
		}
		if row.SecretRefName == nil || *row.SecretRefName != "sre-llm-secrets" {
			t.Fatalf("secret_ref_name not stamped: %+v", row)
		}
		if row.SecretRefKVPath == nil || row.SecretRefProperty == nil {
			t.Fatalf("secret_ref_kv_path/property not stamped: %+v", row)
		}
	})

	t.Run("no writer attached: Set still succeeds", func(t *testing.T) {
		t.Parallel()
		svc, _ := sreLlmDBService(t, http.StatusOK, 0)
		if _, err := svc.Set(context.Background(), "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey); err != nil {
			t.Fatalf("set without a secretRefWriter must still succeed: %v", err)
		}
	})
}

func TestSreLlmGet_AbsentReturnsNilNotError_DB(t *testing.T) {
	t.Parallel()
	svc, _ := sreLlmDBService(t, 0, 0)
	proj, err := svc.Get(context.Background())
	if err != nil || proj != nil {
		t.Fatalf("get with nothing set: want (nil,nil), got (%+v,%v)", proj, err)
	}
}

func TestSreLlmClear_RemovesRowAndBytes_Idempotent_DB(t *testing.T) {
	t.Parallel()
	svc, store := sreLlmDBService(t, http.StatusOK, 0)
	ctx := context.Background()
	if _, err := svc.Set(ctx, "acme", "anthropic", "claude-sonnet-5", sreLlmDBAnthropicKey); err != nil {
		t.Fatalf("set: %v", err)
	}

	if err := svc.Clear(ctx); err != nil {
		t.Fatalf("clear: %v", err)
	}
	proj, err := svc.Get(ctx)
	if err != nil || proj != nil {
		t.Fatalf("get after clear: want nil, got %+v err %v", proj, err)
	}
	if _, err := store.Get(ctx, "platform", "sre-llm/api-key"); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("store after clear: want ErrSecretNotFound, got %v", err)
	}
	if err := svc.Clear(ctx); err != nil {
		t.Fatalf("second clear must be idempotent, got %v", err)
	}
}
