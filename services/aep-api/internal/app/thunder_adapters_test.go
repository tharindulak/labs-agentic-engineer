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

package app

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/projects"
)

func TestToConsumerURLMarker_MapsEnvConfigAndPath(t *testing.T) {
	got := toConsumerURLMarker(dependencies.TypeMarkers{
		ConsumerURLEnvConfig: "redirectUris",
		ConsumerURLPath:      "/callback",
	})
	want := projects.ConsumerURLMarker{EnvConfig: "redirectUris", Path: "/callback"}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestToConsumerURLMarker_EmptyPathDefaultsWhenEnvConfigSet(t *testing.T) {
	got := toConsumerURLMarker(dependencies.TypeMarkers{
		ConsumerURLEnvConfig: "redirectUris",
	})
	if got.EnvConfig != "redirectUris" {
		t.Errorf("EnvConfig = %q, want redirectUris", got.EnvConfig)
	}
	if got.Path != dependencies.DefaultConsumerURLPath {
		t.Errorf("Path = %q, want default %q", got.Path, dependencies.DefaultConsumerURLPath)
	}
}

func TestToConsumerURLMarker_NoEnvConfigStaysEmpty(t *testing.T) {
	got := toConsumerURLMarker(dependencies.TypeMarkers{})
	if got != (projects.ConsumerURLMarker{}) {
		t.Fatalf("got %+v, want zero value", got)
	}
}
