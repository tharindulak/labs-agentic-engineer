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

import "testing"

func TestSplitVersion(t *testing.T) {
	tests := []struct {
		input   string
		want    [3]int
		wantErr bool
	}{
		{"1.1.1", [3]int{1, 1, 1}, false},
		{"1.2.0", [3]int{1, 2, 0}, false},
		{"2.0.0", [3]int{2, 0, 0}, false},
		// Pre-release suffix must be stripped.
		{"1.2.0-rc.1", [3]int{1, 2, 0}, false},
		{"1.1.1-alpha", [3]int{1, 1, 1}, false},
		// Build metadata must be stripped.
		{"1.1.1+build.5", [3]int{1, 1, 1}, false},
		{"1.2.0-rc.1+build.5", [3]int{1, 2, 0}, false},
		// Shorthand must be normalised.
		{"1.2", [3]int{1, 2, 0}, false},
		{"1", [3]int{1, 0, 0}, false},
		// v-prefix is stripped by the caller before splitVersion is reached.
		{"garbage", [3]int{}, true},
		{"1.x.0", [3]int{}, true},
	}
	for _, tc := range tests {
		got, err := splitVersion(tc.input)
		if (err != nil) != tc.wantErr {
			t.Errorf("splitVersion(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
			continue
		}
		if !tc.wantErr && got != tc.want {
			t.Errorf("splitVersion(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}

func TestVersionAtLeast(t *testing.T) {
	const min = "1.1.1"
	tests := []struct {
		version string
		want    bool
		wantErr bool
	}{
		{"1.1.1", true, false},
		{"1.2.0", true, false},
		{"2.0.0", true, false},
		{"1.1.0", false, false},
		{"1.0.9", false, false},
		// Pre-release on a higher base version passes.
		{"1.2.0-rc.1", true, false},
		// Pre-release on the exact minimum version: stripped to 1.1.1 → passes.
		{"1.1.1-rc.1", true, false},
		// Pre-release on a lower version fails.
		{"1.1.0-rc.1", false, false},
		// Build metadata.
		{"1.1.1+build.5", true, false},
		{"1.2.0+build.5", true, false},
		// Shorthand.
		{"1.2", true, false},
		// Invalid.
		{"not-a-version", false, true},
	}
	for _, tc := range tests {
		got, err := versionAtLeast(tc.version, min)
		if (err != nil) != tc.wantErr {
			t.Errorf("versionAtLeast(%q, %q) error = %v, wantErr %v", tc.version, min, err, tc.wantErr)
			continue
		}
		if !tc.wantErr && got != tc.want {
			t.Errorf("versionAtLeast(%q, %q) = %v, want %v", tc.version, min, got, tc.want)
		}
	}
}
