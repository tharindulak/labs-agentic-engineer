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
	"reflect"
	"testing"

	ocgen "github.com/wso2/aep/aep-api/internal/clients/openchoreo/gen"
)

// PublicEndpointURLs exists because "advertised" and "reachable" are different
// facts (ADR-0024). A gateway can publish both schemes and serve only one, so
// the platform hands over every candidate and the runner's preflight decides by
// dialling. publicEndpointURL below keeps picking ONE, for a human to click.

func url(scheme, host string, port int32, path string) *ocgen.EndpointURL {
	return &ocgen.EndpointURL{Scheme: &scheme, Host: host, Port: &port, Path: &path}
}

func TestPublicEndpointURLs_ReturnsEveryAdvertisedURL(t *testing.T) {
	got := PublicEndpointURLs(&ocgen.EndpointGatewayURLs{
		Http:  url("http", "svc.localhost", 19080, "/p"),
		Https: url("https", "svc.localhost", 19443, "/p"),
	})
	want := []string{"https://svc.localhost:19443/p", "http://svc.localhost:19080/p"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v — both candidates, https first", got, want)
	}
}

// The single-scheme cases must still yield exactly one candidate, or the
// preflight would probe a URL nobody advertised.
func TestPublicEndpointURLs_SingleScheme(t *testing.T) {
	if got := PublicEndpointURLs(&ocgen.EndpointGatewayURLs{
		Http: url("http", "svc", 80, "/"),
	}); !reflect.DeepEqual(got, []string{"http://svc:80/"}) {
		t.Errorf("http-only: got %v", got)
	}
	if got := PublicEndpointURLs(&ocgen.EndpointGatewayURLs{
		Https: url("https", "svc", 443, "/"),
	}); !reflect.DeepEqual(got, []string{"https://svc:443/"}) {
		t.Errorf("https-only: got %v", got)
	}
}

// A binding with no external URLs is a component that is not publicly exposed —
// not an error, and not something to invent a URL for.
func TestPublicEndpointURLs_NoneAdvertised(t *testing.T) {
	if got := PublicEndpointURLs(nil); got != nil {
		t.Errorf("nil urls: got %v, want nil", got)
	}
	if got := PublicEndpointURLs(&ocgen.EndpointGatewayURLs{}); got != nil {
		t.Errorf("empty urls: got %v, want nil", got)
	}
}

// The SINGLE-URL pick is the platform's primary answer and is driven by config:
// PreferPlainHTTPEndpoints is set from DataPlaneGatewayTLS, a stated fact about
// the plane. These two cases pin both directions, because a plane whose gateway
// does not terminate TLS still advertises an https URL beside the http one and
// only the http one answers.
func TestPublicEndpointURL_FollowsTheGatewaysStatedTLS(t *testing.T) {
	both := &ocgen.EndpointGatewayURLs{
		Http:  url("http", "svc.localhost", 19080, "/p"),
		Https: url("https", "svc.localhost", 19443, "/p"),
	}
	if got := publicEndpointURL(both, false); got != "https://svc.localhost:19443/p" {
		t.Errorf("TLS plane: got %q, want the https URL", got)
	}
	if got := publicEndpointURL(both, true); got != "http://svc.localhost:19080/p" {
		t.Errorf("plain-http plane: got %q, want the http URL", got)
	}
}

// The fallback in both directions: a binding may advertise only the scheme that
// is NOT preferred, and answering "" there would lose a URL that works.
func TestPublicEndpointURL_FallsBackToTheOnlyAdvertisedScheme(t *testing.T) {
	httpsOnly := &ocgen.EndpointGatewayURLs{Https: url("https", "svc", 443, "/")}
	if got := publicEndpointURL(httpsOnly, true); got != "https://svc:443/" {
		t.Errorf("prefer-http with https-only: got %q", got)
	}
	httpOnly := &ocgen.EndpointGatewayURLs{Http: url("http", "svc", 80, "/")}
	if got := publicEndpointURL(httpOnly, false); got != "http://svc:80/" {
		t.Errorf("prefer-https with http-only: got %q", got)
	}
}
