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
	"os"
	"testing"
)

// TestVendoredExtensionsAssetsMatchSources is the anti-drift guard for the
// three files go:embed'd from sre_extensions_assets/ (see the doc-comment on
// those //go:embed directives in sre_extensions.go). go:embed cannot cross
// the ".." out of tools/aectl/cmd — go:embed patterns flatly reject any ".."
// element, independent of module boundaries — so the true sources are
// vendored here as byte-identical copies instead. This test is the guard
// designspec/securityspec already use for the same problem
// (services/aep-api/internal/platform/{designspec,securityspec}/schema_vendor_test.go):
// it fails byte-for-byte on any drift between a vendored copy and its source.
//
// Re-sync on failure: copy the named source file over its vendored copy in
// sre_extensions_assets/, in the same commit as whatever changed the source.
func TestVendoredExtensionsAssetsMatchSources(t *testing.T) {
	cases := []struct {
		vendored string
		source   string
	}{
		{
			vendored: "sre_extensions_assets/SKILL.md",
			// tools/aectl/cmd → aectl → tools → repo root.
			source: "../../../services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md",
		},
		{
			vendored: "sre_extensions_assets/CONTEXT.md",
			source:   "../../../deployments/sre-agent-extensions/remediation/CONTEXT.md",
		},
		{
			vendored: "sre_extensions_assets/mcp.json",
			source:   "../../../deployments/sre-agent-extensions/remediation/mcp.json",
		},
	}

	for _, c := range cases {
		t.Run(c.vendored, func(t *testing.T) {
			got, err := os.ReadFile(c.vendored)
			if err != nil {
				t.Fatalf("read vendored copy: %v", err)
			}
			want, err := os.ReadFile(c.source)
			if err != nil {
				t.Fatalf("read source (%s) — layout drift?: %v", c.source, err)
			}
			if string(got) != string(want) {
				t.Fatalf("vendored %s differs from %s — re-sync: copy the source file over the vendored "+
					"copy in tools/aectl/cmd/sre_extensions_assets/", c.vendored, c.source)
			}
		})
	}
}
