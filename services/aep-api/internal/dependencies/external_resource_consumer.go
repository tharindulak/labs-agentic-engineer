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

package dependencies

// ExternalResourceConsumer is one component that depends on a resource,
// identified by the project and component that declares it. It is the value
// type the cross-project committed-design consumer scans return (both the
// external-resource and platform-resource "used by" sweeps) — AEP keeps no
// consumer table; consumers are derived by scanning design.json.
type ExternalResourceConsumer struct {
	ProjectID     string `json:"projectId"`
	ComponentName string `json:"componentName"`
}
