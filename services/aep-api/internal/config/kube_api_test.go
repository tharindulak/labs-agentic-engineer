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

package config

import (
	"testing"
)

func TestKubeAPI_InClusterHostPort(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "443")
	t.Setenv("KUBE_API_BASE_URL", "http://should-not-win")
	t.Setenv("KUBE_API_BEARER", "override-token")

	r := &configReader{}
	got := r.kubeAPI()
	if got.BaseURL != "https://10.0.0.1:443" {
		t.Errorf("BaseURL = %q, want in-cluster URL", got.BaseURL)
	}
	if got.BearerToken != "override-token" {
		t.Errorf("BearerToken = %q, want override", got.BearerToken)
	}
}

func TestKubeAPI_FallbackEnvBaseURL(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("KUBERNETES_SERVICE_PORT", "")
	t.Setenv("KUBE_API_BASE_URL", "https://kube.example:6443")
	t.Setenv("KUBE_API_BEARER", "")

	r := &configReader{}
	got := r.kubeAPI()
	if got.BaseURL != "https://kube.example:6443" {
		t.Errorf("BaseURL = %q, want KUBE_API_BASE_URL", got.BaseURL)
	}
}

func TestKubeAPI_IPv6HostPort(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "fd00::1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "443")
	t.Setenv("KUBE_API_BEARER", "override-token")

	r := &configReader{}
	got := r.kubeAPI()
	if got.BaseURL != "https://[fd00::1]:443" {
		t.Errorf("BaseURL = %q, want bracketed IPv6 URL", got.BaseURL)
	}
}

func TestKubeAPI_EmptyWhenUnresolved(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("KUBERNETES_SERVICE_PORT", "")
	t.Setenv("KUBE_API_BASE_URL", "")
	t.Setenv("KUBE_API_BEARER", "")

	r := &configReader{}
	got := r.kubeAPI()
	if got.BaseURL != "" {
		t.Errorf("BaseURL = %q, want empty when unresolved", got.BaseURL)
	}
}
