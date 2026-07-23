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

// Package validate provides handler-boundary input validators for identifiers
// (orgHandle, projectName, componentName, taskId, ocOrgId) before they reach
// services / repositories / OpenChoreo proxies / shell templates. Validation
// here is conservative — anything that can land in a filesystem path, OpenBao
// path, or k8s resource name has to pass these checks.
package validate

import (
	"errors"
	"regexp"
)

// ErrInvalidSlug is returned when a value fails slug validation.
var ErrInvalidSlug = errors.New("invalid identifier: must be a DNS-label-shaped slug (lowercase alphanumeric or '-', 1-63 chars, must start with alphanumeric)")

// slugRE matches a DNS-label-shaped slug: lowercase, must start with
// alphanumeric, alphanumeric + hyphen otherwise, max 63 chars. Mirrors
// git-service's pkg/credentials/openbao_store.go regex and remote-worker's
// lib/uuid.ts isSlug.
var slugRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// Slug enforces that v is a DNS-label-shaped slug. Used at handler
// boundaries for orgHandle / projectName / componentName / ocOrgId —
// anything that can land in a filesystem path or storage key. Rejects
// path traversal (`..`, `/`), shell metacharacters, uppercase, embedded
// nulls / newlines, and overlong values.
func Slug(v string) error {
	if !slugRE.MatchString(v) {
		return ErrInvalidSlug
	}
	return nil
}
