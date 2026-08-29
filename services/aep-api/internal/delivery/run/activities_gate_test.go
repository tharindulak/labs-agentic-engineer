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

package run

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

type stubGate struct {
	unconfigured []string
	provisioning []string
	err          error
}

func (g stubGate) DeploymentReadiness(context.Context, string, string, string) ([]string, []string, error) {
	return g.unconfigured, g.provisioning, g.err
}

// recordingRuns is a RunStore that records only the two writes this file cares
// about, so a test can assert which of them the park chose.
type recordingRuns struct {
	RunStore
	states []string
	parks  []struct {
		reason string
		deps   []string
	}
}

func (r *recordingRuns) SetState(_ context.Context, _, state string) error {
	r.states = append(r.states, state)
	return nil
}

func (r *recordingRuns) SetWaiting(_ context.Context, _, reason string, deps []string) error {
	r.parks = append(r.parks, struct {
		reason string
		deps   []string
	}{reason, deps})
	return nil
}

// TestCheckDeployReadiness_UnwiredFailsClosed is the one activity in this
// package that must NOT degrade to "nothing to do". Every other optional
// collaborator's worst case is work not happening; this one's worst case is a
// deploy that publishes an application with empty credentials — the exact
// outcome the gate exists to prevent. Non-retryable, because waiting does not
// wire a port.
func TestCheckDeployReadiness_UnwiredFailsClosed(t *testing.T) {
	acts := NewActivities(Deps{})

	_, err := acts.CheckDeployReadiness(context.Background(), ProjectRef{OrgID: "acme", ProjectID: "shop"})

	require.Error(t, err, "an unwired gate must refuse, never wave the deploy through")
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr))
	require.True(t, appErr.NonRetryable(), "retrying cannot wire a missing port")
}

// TestCheckDeployReadiness_ReportsBothBlockersSeparately: the workflow treats
// the two differently — it polls one and parks on the other — so the activity
// must not collapse them into a single "not ready".
func TestCheckDeployReadiness_ReportsBothBlockersSeparately(t *testing.T) {
	acts := NewActivities(Deps{DeployGate: stubGate{
		unconfigured: []string{"stripe"},
		provisioning: []string{"postgres"},
	}})

	verdict, err := acts.CheckDeployReadiness(context.Background(), ProjectRef{OrgID: "acme", ProjectID: "shop"})

	require.NoError(t, err)
	require.Equal(t, []string{"stripe"}, verdict.Unconfigured)
	require.Equal(t, []string{"postgres"}, verdict.Provisioning)
}

// TestCheckDeployReadiness_ReadErrorIsRetryable: a gate that could not be READ
// is a blip, not a verdict. It must surface as an ordinary retryable error so
// Temporal's policy answers it — the non-retryable refusal above is reserved for
// the one cause repeating cannot change.
func TestCheckDeployReadiness_ReadErrorIsRetryable(t *testing.T) {
	acts := NewActivities(Deps{DeployGate: stubGate{err: errors.New("openchoreo unreachable")}})

	_, err := acts.CheckDeployReadiness(context.Background(), ProjectRef{OrgID: "acme", ProjectID: "shop"})

	require.Error(t, err)
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		require.False(t, appErr.NonRetryable(), "a read failure is a blip; retrying is the right answer")
	}
}

// TestSetRunState_RoutesTheParksExplanationToSetWaiting pins the routing in
// SetRunState. The reason and the dependency names have to reach the row through
// SetWaiting — the ONE write that carries both — or the console reads a
// `waiting` row whose explanation never landed.
func TestSetRunState_RoutesTheParksExplanationToSetWaiting(t *testing.T) {
	runs := &recordingRuns{}
	acts := NewActivities(Deps{Runs: runs})
	ctx := context.Background()

	require.NoError(t, acts.SetRunState(ctx, SetRunStateInput{
		RunID:                "run-1",
		State:                delivery.RunStateWaiting,
		WaitingReason:        delivery.RunWaitingOnExternalValues,
		BlockingDependencies: []string{"stripe", "twilio"},
	}))
	require.Len(t, runs.parks, 1)
	require.Equal(t, delivery.RunWaitingOnExternalValues, runs.parks[0].reason)
	require.Equal(t, []string{"stripe", "twilio"}, runs.parks[0].deps)
	require.Empty(t, runs.states, "an explained park must not also take the plain SetState path")

	// A park with NO explanation is the ordinary between-cycles one and still
	// goes through SetState — routing it to SetWaiting would blank the reason of
	// a run that the gate had just parked.
	require.NoError(t, acts.SetRunState(ctx, SetRunStateInput{
		RunID: "run-1", State: delivery.RunStateWaiting,
	}))
	require.Equal(t, []string{delivery.RunStateWaiting}, runs.states)
	require.Len(t, runs.parks, 1)
}
