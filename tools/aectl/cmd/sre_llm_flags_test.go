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

package cmd

import (
	"bytes"
	"strings"
	"testing"
	"text/template"
)

func TestSreInstallCmd_HasSreLlmFlags(t *testing.T) {
	t.Parallel()
	f := sreInstallCmd.Flags()
	for _, name := range []string{"sre-llm-provider", "sre-llm-model", "sre-llm-api-key"} {
		if f.Lookup(name) == nil {
			t.Fatalf("sre install must define --%s", name)
		}
	}
}

func TestSreSecretsTmpl_RendersSreLlmSecretWhenProvided(t *testing.T) {
	t.Parallel()
	p := sreParams{
		ObsNamespace:   "openchoreo-observability-plane",
		SreLlmVaultKey: "aep/sre-llm-api-key",
	}
	rendered, err := renderTemplateForTest(sreSecretsTmpl, p)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !containsForTest(rendered, "name: sre-llm-secret") {
		t.Fatalf("rendered secrets template must define sre-llm-secret when SreLlmVaultKey is set:\n%s", rendered)
	}
	if !containsForTest(rendered, "key: aep/sre-llm-api-key") {
		t.Fatalf("rendered secrets template must reference the given vault key:\n%s", rendered)
	}
}

func TestSreSecretsTmpl_OmitsSreLlmSecretWhenNotProvided(t *testing.T) {
	t.Parallel()
	p := sreParams{
		ObsNamespace: "openchoreo-observability-plane",
	}
	rendered, err := renderTemplateForTest(sreSecretsTmpl, p)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if containsForTest(rendered, "name: sre-llm-secret") {
		t.Fatalf("rendered secrets template must not define sre-llm-secret when SreLlmVaultKey is unset:\n%s", rendered)
	}
}

func TestSreObsPlaneValuesTmpl_UsesSreLlmModelNameWhenSet(t *testing.T) {
	t.Parallel()
	p := sreParams{
		RcaModel:        "anthropic:claude-sonnet-4-6",
		SreLlmModelName: "openai:gpt-4o-mini",
	}
	rendered, err := renderTemplateForTest(sreObsPlaneValuesTmpl, p)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !containsForTest(rendered, "modelName: openai:gpt-4o-mini") {
		t.Fatalf("rendered obs-plane values must use SreLlmModelName when set:\n%s", rendered)
	}
}

func TestSreObsPlaneValuesTmpl_FallsBackToRcaModelWhenSreLlmModelNameUnset(t *testing.T) {
	t.Parallel()
	p := sreParams{
		RcaModel: "anthropic:claude-sonnet-4-6",
	}
	rendered, err := renderTemplateForTest(sreObsPlaneValuesTmpl, p)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !containsForTest(rendered, "modelName: anthropic:claude-sonnet-4-6") {
		t.Fatalf("rendered obs-plane values must fall back to RcaModel:\n%s", rendered)
	}
}

func renderTemplateForTest(tmpl string, p sreParams) (string, error) {
	t, err := template.New("test").Parse(tmpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, p); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func containsForTest(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}
