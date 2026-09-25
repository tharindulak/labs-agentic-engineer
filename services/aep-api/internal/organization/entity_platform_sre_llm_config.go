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

import "time"

// PlatformSreLlmConfig is the SRE agent's platform-wide LLM configuration —
// the ONE non-org-scoped credential row in this package (the platform_
// prefix flags that). Unlike org_anthropic_credentials there is exactly one
// row: ID is always 1, enforced by the repository always targeting id=1
// rather than by a second table constraint.
//
// Secret bytes live in the same CredentialStore (Postgres + AES-256-GCM)
// every other credential in this package uses, keyed by the fixed sentinel
// org id "platform" (distinct from the reserved "_platform") since this
// config has no real org. See docs/superpowers/specs/2026-09-23-sre-agent-llm-key-design.md.
type PlatformSreLlmConfig struct {
	ID              int        `gorm:"column:id;primaryKey;autoIncrement:false" json:"-"`
	Provider        string     `gorm:"column:provider;type:text;not null" json:"provider"`
	Model           string     `gorm:"column:model;type:text;not null" json:"model"`
	KeyPrefix       string     `gorm:"column:key_prefix;type:text;not null" json:"keyPrefix"`
	KeyLast4        string     `gorm:"column:key_last4;type:text;not null" json:"keyLast4"`
	Status          string     `gorm:"column:status;type:text;not null;default:active" json:"status"`
	ConnectedAt     time.Time  `gorm:"column:connected_at;not null;default:now()" json:"connectedAt"`
	LastValidatedAt *time.Time `gorm:"column:last_validated_at" json:"lastValidatedAt,omitempty"`
	ValidationError *string    `gorm:"column:validation_error;type:text" json:"validationError,omitempty"`

	// Secret-ref triplet — same shape as OrgAnthropicCredential's, populated
	// by SecretRefWriter.WriteSreLlm when a secrets provider is configured.
	SecretRefName     *string `gorm:"column:secret_ref_name;type:text" json:"-"`
	SecretRefKVPath   *string `gorm:"column:secret_ref_kv_path;type:text" json:"-"`
	SecretRefProperty *string `gorm:"column:secret_ref_property;type:text" json:"-"`
}

func (PlatformSreLlmConfig) TableName() string { return "platform_sre_llm_config" }
