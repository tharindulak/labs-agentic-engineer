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

package ops_test

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/ops"
)

func TestClassifyActions(t *testing.T) {
	// The contract makes the items nullable, so a status the remediation agent
	// never set arrives as nil rather than as a missing entry.
	at := func(values ...string) []*string {
		statuses := make([]*string, 0, len(values))
		for _, value := range values {
			if value == "<nil>" {
				statuses = append(statuses, nil)
				continue
			}
			status := value
			statuses = append(statuses, &status)
		}
		return statuses
	}
	tests := []struct {
		name     string
		statuses []*string
		want     string
	}{
		{"no actions at all", nil, ops.ClassificationNone},
		{"every action already applied", at("applied", "applied"), ops.ClassificationNone},
		{"applied and dismissed settle to nothing pending", at("applied", "dismissed"), ops.ClassificationNone},
		{"configuration expressed every action", at("revised", "revised"), ops.ClassificationConfigLevel},
		{"configuration expressed the rest", at("revised", "applied"), ops.ClassificationConfigLevel},
		{"one action remediation could not express", at("suggested"), ops.ClassificationCodeLevel},
		{"some config, some code", at("revised", "suggested"), ops.ClassificationMixed},
		// The load-bearing rows: remediation is off by default, so on a fresh
		// install every action arrives with no status. Reading that as "nothing
		// to do" would silence the whole loop.
		{"an absent status is pending code work", at("<nil>"), ops.ClassificationCodeLevel},
		{"absent alongside config is mixed", at("<nil>", "revised"), ops.ClassificationMixed},
		{"a status nobody here recognises is pending", at("deferred"), ops.ClassificationCodeLevel},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ops.ClassifyActions(tt.statuses); got != tt.want {
				t.Errorf("ClassifyActions(%v) = %q, want %q", tt.statuses, got, tt.want)
			}
		})
	}
}

func TestAdoptableClassificationWithholdsOnlyConfigLevel(t *testing.T) {
	// config-level is still FILED — it is the adoption that is withheld, because
	// configuration already expressed every action.
	if ops.AdoptableClassification(ops.ClassificationConfigLevel) {
		t.Error("config-level must not be adopted")
	}
	for _, classification := range []string{
		ops.ClassificationCodeLevel,
		ops.ClassificationMixed,
		ops.ClassificationNone,
	} {
		if !ops.AdoptableClassification(classification) {
			t.Errorf("%s must be adopted", classification)
		}
	}
}

func TestNamespaceDedupeKeySeparatesConfigHandledFilings(t *testing.T) {
	const key = "sre-rca/service1/f683d98f8a"

	if got := ops.NamespaceDedupeKey(key, ops.ClassificationConfigLevel); got != key+"/config" {
		t.Errorf("config-level key = %q, want the config namespace", got)
	}
	for _, classification := range []string{
		ops.ClassificationCodeLevel,
		ops.ClassificationMixed,
		ops.ClassificationNone,
	} {
		if got := ops.NamespaceDedupeKey(key, classification); got != key {
			t.Errorf("%s key = %q, want it unchanged", classification, got)
		}
	}
	// No key means the caller asked for no deduplication at all; inventing a
	// namespace would start deduplicating calls that opted out.
	if got := ops.NamespaceDedupeKey("", ops.ClassificationConfigLevel); got != "" {
		t.Errorf("empty key = %q, want it left empty", got)
	}
}
