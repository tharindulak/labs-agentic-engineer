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

// DBTEST tier (skips under -short; `make test-db` runs it): the REAL
// PlatformSreLlmRepository over a pristine per-test Postgres (dbtest.New) —
// the singleton upsert/update/delete behavior under pin.
//
// External test package: an in-package dbtest file would be an import cycle
// (dbtest imports migrate, which imports organization), same as
// anthropic_dbtest_test.go.

import (
	"context"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

func TestPlatformSreLlmRepository_GetAbsentReturnsNilNotError(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := organization.NewPlatformSreLlmRepository(db)
	row, err := repo.Get(context.Background())
	if err != nil {
		t.Fatalf("get on empty table: %v", err)
	}
	if row != nil {
		t.Fatalf("get on empty table: want nil row, got %+v", row)
	}
}

func TestPlatformSreLlmRepository_UpsertIsSingleton(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := organization.NewPlatformSreLlmRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	first := &organization.PlatformSreLlmConfig{
		Provider: "anthropic", Model: "claude-sonnet-5",
		KeyPrefix: "sk-ant-api03-Ab", KeyLast4: "1234",
		Status: "active", ConnectedAt: now, LastValidatedAt: &now,
	}
	if err := repo.Upsert(ctx, first); err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	later := now.Add(time.Hour)
	second := &organization.PlatformSreLlmConfig{
		Provider: "openai", Model: "gpt-4o-mini",
		KeyPrefix: "sk-test-abcde", KeyLast4: "9999",
		Status: "active", ConnectedAt: later, LastValidatedAt: &now,
	}
	if err := repo.Upsert(ctx, second); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get after two upserts: %v", err)
	}
	if got == nil || got.Provider != "openai" || got.Model != "gpt-4o-mini" {
		t.Fatalf("upsert must replace the single row, got %+v", got)
	}
	// A provider switch is a fresh connection, not a rotation of the old
	// one: connected_at must move to the SECOND upsert's value, not stay
	// pinned to the first (unlike OrgAnthropicCredential's same-slot
	// rotation, which deliberately preserves the original).
	if !got.ConnectedAt.Equal(later) {
		t.Fatalf("connected_at must reflect the second upsert, want %v got %v", later, got.ConnectedAt)
	}

	var count int64
	if err := db.Table("platform_sre_llm_config").Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("table must hold exactly one row, got %d", count)
	}
}

func TestPlatformSreLlmRepository_UpdateColumnsAndDelete(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := organization.NewPlatformSreLlmRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := repo.Upsert(ctx, &organization.PlatformSreLlmConfig{
		Provider: "anthropic", Model: "claude-sonnet-5",
		KeyPrefix: "sk-ant-api03-Ab", KeyLast4: "1234",
		Status: "active", ConnectedAt: now, LastValidatedAt: &now,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	ref := "sre-llm"
	if err := repo.UpdateColumns(ctx, map[string]any{"secret_ref_name": ref}); err != nil {
		t.Fatalf("update columns: %v", err)
	}
	got, err := repo.Get(ctx)
	if err != nil || got.SecretRefName == nil || *got.SecretRefName != ref {
		t.Fatalf("secret_ref_name not stamped: %+v err %v", got, err)
	}

	if err := repo.Delete(ctx); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if got != nil {
		t.Fatalf("get after delete: want nil, got %+v", got)
	}
	// Idempotent.
	if err := repo.Delete(ctx); err != nil {
		t.Fatalf("second delete must be a no-op, got %v", err)
	}
}

func TestPlatformSreLlmRepository_UpsertClearsStaleSecretRef(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := organization.NewPlatformSreLlmRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := repo.Upsert(ctx, &organization.PlatformSreLlmConfig{
		Provider: "anthropic", Model: "claude-sonnet-5",
		KeyPrefix: "sk-ant-api03-Ab", KeyLast4: "1234",
		Status: "active", ConnectedAt: now, LastValidatedAt: &now,
	}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	ref := "sre-llm"
	if err := repo.UpdateColumns(ctx, map[string]any{"secret_ref_name": ref}); err != nil {
		t.Fatalf("update columns: %v", err)
	}
	got, err := repo.Get(ctx)
	if err != nil || got.SecretRefName == nil || *got.SecretRefName != ref {
		t.Fatalf("secret_ref_name not stamped before the second upsert: %+v err %v", got, err)
	}

	// Simulate a provider switch (anthropic -> openai): the second Upsert
	// must clear the stale secret ref from the FIRST connection, not carry
	// it forward onto the new one.
	if err := repo.Upsert(ctx, &organization.PlatformSreLlmConfig{
		Provider: "openai", Model: "gpt-4o-mini",
		KeyPrefix: "sk-test-abcde", KeyLast4: "9999",
		Status: "active", ConnectedAt: now, LastValidatedAt: &now,
	}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get after second upsert: %v", err)
	}
	if got.SecretRefName != nil {
		t.Fatalf("secret_ref_name must be cleared by the second upsert, got %+v", *got.SecretRefName)
	}
}
