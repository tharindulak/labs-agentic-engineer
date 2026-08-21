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

package openchoreo

import (
	"testing"

	ocgen "github.com/wso2/aep/aep-api/internal/clients/openchoreo/gen"
)

func TestDeploymentFromReleaseBinding_HTTPSOnlyPopulatesEndpointURL(t *testing.T) {
	got := deploymentFromReleaseBinding(bindingWithExternal(httpsURL(
		"development-wc-019feb11-3f4674c4.gateway.dp.dev.cloud.wso2.com",
		"/hello-world-api-16-hello-api-http",
		443,
	), nil))
	want := "https://development-wc-019feb11-3f4674c4.gateway.dp.dev.cloud.wso2.com:443/hello-world-api-16-hello-api-http"
	if got.EndpointURL != want {
		t.Fatalf("EndpointURL = %q, want %q", got.EndpointURL, want)
	}
}

func TestDeploymentFromReleaseBinding_HTTPOnlyStillWorks(t *testing.T) {
	got := deploymentFromReleaseBinding(bindingWithExternal(nil, httpURL(
		"web.local",
		"/",
		80,
	)))
	want := "http://web.local:80/"
	if got.EndpointURL != want {
		t.Fatalf("EndpointURL = %q, want %q", got.EndpointURL, want)
	}
}

func TestDeploymentFromReleaseBinding_PrefersHTTPSWhenBothPresent(t *testing.T) {
	got := deploymentFromReleaseBinding(bindingWithExternal(
		httpsURL("gw.example.com", "/app", 443),
		httpURL("gw.example.com", "/app", 80),
	))
	want := "https://gw.example.com:443/app"
	if got.EndpointURL != want {
		t.Fatalf("EndpointURL = %q, want %q", got.EndpointURL, want)
	}
}

func TestDeploymentFromReleaseBinding_NeitherSchemeOmitsEndpointURL(t *testing.T) {
	got := deploymentFromReleaseBinding(bindingWithExternal(nil, nil))
	if got.EndpointURL != "" {
		t.Fatalf("EndpointURL = %q, want empty", got.EndpointURL)
	}
}

func bindingWithExternal(https, http *ocgen.EndpointURL) ocgen.ReleaseBinding {
	release := "hello-api-rel"
	eps := []ocgen.EndpointURLStatus{{
		Name: "http",
		ExternalURLs: &ocgen.EndpointGatewayURLs{
			Https: https,
			Http:  http,
		},
	}}
	return ocgen.ReleaseBinding{
		Metadata: ocgen.ObjectMeta{Name: "hello-api-development"},
		Spec: &ocgen.ReleaseBindingSpec{
			Environment: "development",
			ReleaseName: &release,
			Owner: struct {
				ComponentName string `json:"componentName"`
				ProjectName   string `json:"projectName"`
			}{ComponentName: "proj-hello-api", ProjectName: "proj"},
		},
		Status: &ocgen.ReleaseBindingStatus{Endpoints: &eps},
	}
}

func httpsURL(host, path string, port int32) *ocgen.EndpointURL {
	scheme := "https"
	p := path
	return &ocgen.EndpointURL{Host: host, Path: &p, Port: &port, Scheme: &scheme}
}

func httpURL(host, path string, port int32) *ocgen.EndpointURL {
	scheme := "http"
	p := path
	return &ocgen.EndpointURL{Host: host, Path: &p, Port: &port, Scheme: &scheme}
}
