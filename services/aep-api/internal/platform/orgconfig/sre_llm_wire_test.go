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

package orgconfig_test

import (
	"encoding/json"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/orgconfig"
)

func TestSreLlmWrite_UnmarshalsAllFields(t *testing.T) {
	t.Parallel()
	var patch orgconfig.ConfigPatch
	body := []byte(`{"sreLlm":{"provider":"openai","model":"gpt-4o-mini","apiKey":"sk-test-123456789012345"}}`)
	if err := json.Unmarshal(body, &patch); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !patch.SreLLM.Sent || patch.SreLLM.Null {
		t.Fatalf("SreLLM three-state: got Sent=%v Null=%v, want Sent=true Null=false", patch.SreLLM.Sent, patch.SreLLM.Null)
	}
	if patch.SreLLM.Value.Provider != "openai" || patch.SreLLM.Value.Model != "gpt-4o-mini" || patch.SreLLM.Value.APIKey != "sk-test-123456789012345" {
		t.Fatalf("SreLLM.Value fields drifted: %+v", patch.SreLLM.Value)
	}
}

func TestSreLlmWrite_NullClears(t *testing.T) {
	t.Parallel()
	var patch orgconfig.ConfigPatch
	if err := json.Unmarshal([]byte(`{"sreLlm":null}`), &patch); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !patch.SreLLM.Sent || !patch.SreLLM.Null {
		t.Fatalf("SreLLM null: got Sent=%v Null=%v, want both true", patch.SreLLM.Sent, patch.SreLLM.Null)
	}
}

func TestSreLlmProjection_MarshalsExpectedFieldSet(t *testing.T) {
	t.Parallel()
	proj := orgconfig.ConfigProjection{SreLLM: nil}
	raw, err := json.Marshal(proj)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	v, ok := m["sreLlm"]
	if !ok {
		t.Fatal("ConfigProjection must always carry a (possibly null) sreLlm key")
	}
	if v != nil {
		t.Fatalf("sreLlm with SreLLM=nil must marshal to null, got %v", v)
	}
}
