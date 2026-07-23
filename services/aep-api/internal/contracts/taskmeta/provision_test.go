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

package taskmeta

import (
	"testing"
	"time"
)

func TestProvisionKindValidAndDerivesDeployed(t *testing.T) {
	// A succeeded provision run derives deployed (no PR/build) so dependent
	// coding tasks unblock — the ops arm, extended for provision.
	execs := []ExecutionFact{{Kind: KindProvision, Status: ExecSucceeded, CreatedAt: time.Unix(1, 0)}}
	if got := Derive(GitHubFacts{IssueOpen: true}, execs); got != StatusDeployed {
		t.Fatalf("succeeded provision run: want deployed, got %q", got)
	}
	// An active provision run derives in_progress (drawer shows "provisioning").
	execs = []ExecutionFact{{Kind: KindProvision, Status: ExecRunning, CreatedAt: time.Unix(1, 0)}}
	if got := Derive(GitHubFacts{IssueOpen: true}, execs); got != StatusInProgress {
		t.Fatalf("running provision run: want in_progress, got %q", got)
	}
	// A failed provision run derives failed.
	execs = []ExecutionFact{{Kind: KindProvision, Status: ExecFailed, CreatedAt: time.Unix(1, 0)}}
	if got := Derive(GitHubFacts{IssueOpen: true}, execs); got != StatusFailed {
		t.Fatalf("failed provision run: want failed, got %q", got)
	}
}

func TestProvisionClassLabelAndParse(t *testing.T) {
	if !ClassProvision.Valid() {
		t.Fatalf("ClassProvision must be valid")
	}
	if got := ClassLabel(ClassProvision); got != LabelProvision {
		t.Fatalf("ClassLabel(ClassProvision) = %q, want %q", got, LabelProvision)
	}
	p := ParseLabels([]string{LabelMarker, LabelProvision, OriginLabel(OriginSpecPlan)})
	if !p.IsTask || p.Class != ClassProvision || p.ClassAmbiguous {
		t.Fatalf("ParseLabels provision: got %+v", p)
	}
	// A provision + coding pair is ambiguous (two class labels).
	amb := ParseLabels([]string{LabelMarker, LabelProvision, LabelCoding})
	if !amb.ClassAmbiguous {
		t.Fatalf("two class labels must be ambiguous, got %+v", amb)
	}
}

func TestBlockGateKindRoundTrips(t *testing.T) {
	in := Block{
		Component: "orders-db",
		GateKind:  GateResourceProvisioning,
		Origin:    OriginSpecPlan,
		DesignTag: "design-v3",
		Key:       "abc123",
	}
	body := ComposeBody(in, Human{Rationale: "provision the db"})
	out, err := ParseBlock(body)
	if err != nil {
		t.Fatalf("ParseBlock: %v", err)
	}
	if out.GateKind != GateResourceProvisioning {
		t.Fatalf("GateKind round-trip: want %q, got %q", GateResourceProvisioning, out.GateKind)
	}
	if out.Component != "orders-db" || out.Origin != OriginSpecPlan || out.DesignTag != "design-v3" {
		t.Fatalf("provision block round-trip lost fields: %+v", out)
	}
}
