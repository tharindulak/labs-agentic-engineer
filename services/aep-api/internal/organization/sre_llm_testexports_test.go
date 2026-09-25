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

import "testing"

// Exported-for-tests wrappers so the external organization_test package
// (dbtest-tier files, which must live outside this package to import
// dbtest without an import cycle — see anthropic_dbtest_test.go's doc
// comment) can reuse the in-package fake-API helpers. Capitalized (unlike
// the brief's paraphrase) because cross-package visibility in Go requires
// an exported identifier, not just an "Exported" name suffix.
func AnthropicFakeAPIExported(t testing.TB, status int) (string, *anthropicProbeCapture) {
	return anthropicFakeAPI(t, status)
}

func OpenAIFakeAPIExported(t testing.TB, status int) (string, *anthropicProbeCapture) {
	return openaiFakeAPI(t, status)
}
