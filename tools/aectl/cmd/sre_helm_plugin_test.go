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
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteSREPostRenderPlugin(t *testing.T) {
	dir := t.TempDir()
	name, err := writeSREPostRenderPlugin(dir, "/usr/local/bin/aectl")
	if err != nil {
		t.Fatal(err)
	}
	if name != srePostRenderPluginName {
		t.Fatalf("name = %q", name)
	}
	b, err := os.ReadFile(filepath.Join(dir, srePostRenderPluginName, "plugin.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"postrenderer/v1", "/usr/local/bin/aectl", "post-render"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("plugin.yaml missing %q:\n%s", want, b)
		}
	}
}
