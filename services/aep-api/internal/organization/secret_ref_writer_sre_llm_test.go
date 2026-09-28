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
	"testing"
)

func TestSecretRefWriter_WriteSreLlm_DisabledIsNoop(t *testing.T) {
	t.Parallel()
	var w *SecretRefWriter // nil writer, Enabled() == false
	name, err := w.WriteSreLlm(context.Background(), "acme", "sk-ant-api03-whatever")
	if err != nil || name != "" {
		t.Fatalf("disabled writer: want (\"\", nil), got (%q, %v)", name, err)
	}
}

func TestSecretRefWriter_WriteSreLlm_RequiresOrgAndKey(t *testing.T) {
	t.Parallel()
	w := NewSecretRefWriter(nil, nil, nil, nil, nil) // client nil -> still disabled
	if _, err := w.WriteSreLlm(context.Background(), "", "sk-ant-api03-whatever"); err != nil {
		t.Fatalf("disabled writer ignores validation and returns nil: got %v", err)
	}
}
