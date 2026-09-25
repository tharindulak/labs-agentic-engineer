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

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// PlatformSreLlmRepository persists the platform's singleton SRE agent LLM
// config row (platform_sre_llm_config, always id=1). Unlike
// OrgAnthropicRepository there is no org/role scoping and no advisory lock —
// a single row has no cross-request race the way a per-org upsert does under
// concurrent Connects for different orgs.
type PlatformSreLlmRepository interface {
	// Get returns the singleton row, or nil when it has never been set (not
	// an error).
	Get(ctx context.Context) (*PlatformSreLlmConfig, error)
	// Upsert INSERTs the row (id=1) or, on conflict, UPDATEs it — always
	// exactly one row.
	Upsert(ctx context.Context, row *PlatformSreLlmConfig) error
	// UpdateColumns writes the given columns onto the singleton row.
	UpdateColumns(ctx context.Context, updates map[string]any) error
	// Delete removes the singleton row. Idempotent — deleting an absent row
	// is a no-op.
	Delete(ctx context.Context) error
}

type platformSreLlmRepository struct {
	db *gorm.DB
}

// NewPlatformSreLlmRepository constructs the gorm-backed PlatformSreLlmRepository.
func NewPlatformSreLlmRepository(db *gorm.DB) PlatformSreLlmRepository {
	return &platformSreLlmRepository{db: db}
}

func (r *platformSreLlmRepository) Get(ctx context.Context) (*PlatformSreLlmConfig, error) {
	var row PlatformSreLlmConfig
	err := r.db.WithContext(ctx).Where("id = ?", 1).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *platformSreLlmRepository) Upsert(ctx context.Context, row *PlatformSreLlmConfig) error {
	row.ID = 1
	return r.db.WithContext(ctx).Exec(`
		INSERT INTO platform_sre_llm_config
		    (id, provider, model, key_prefix, key_last4, status, connected_at, last_validated_at, validation_error)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT (id) DO UPDATE
		  SET provider           = EXCLUDED.provider,
		      model              = EXCLUDED.model,
		      key_prefix         = EXCLUDED.key_prefix,
		      key_last4          = EXCLUDED.key_last4,
		      status             = EXCLUDED.status,
		      last_validated_at  = EXCLUDED.last_validated_at,
		      validation_error   = NULL`,
		row.Provider, row.Model, row.KeyPrefix, row.KeyLast4, row.Status, row.ConnectedAt, row.LastValidatedAt,
	).Error
}

func (r *platformSreLlmRepository) UpdateColumns(ctx context.Context, updates map[string]any) error {
	return r.db.WithContext(ctx).
		Model(&PlatformSreLlmConfig{}).
		Where("id = ?", 1).
		Updates(updates).Error
}

func (r *platformSreLlmRepository) Delete(ctx context.Context) error {
	return r.db.WithContext(ctx).Exec(`DELETE FROM platform_sre_llm_config WHERE id = 1`).Error
}
