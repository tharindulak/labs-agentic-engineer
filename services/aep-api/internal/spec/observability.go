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

package spec

// ResolveAutoRCAEnabled reports whether the platform should auto-provision the
// default "error → RCA" observability-alert-rule trait for this component.
//
// Sensible defaults: service components only (an error-log alert on a
// web-app / library is meaningless — their container logs are a static
// file server, not the application code that would log an error), and
// opt-out per component via the design.json `disableAutoRca: true` key.
func ResolveAutoRCAEnabled(comp DesignComponent) bool {
	return comp.ComponentType == ComponentTypeService && !comp.DisableAutoRca
}
