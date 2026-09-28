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
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/clients/kubeobs"
	"github.com/wso2/aep/aep-api/internal/config"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/secrets"
	"github.com/wso2/aep/aep-api/internal/sreagent"
)

// newSREAgentReconciler builds the reconciler that pushes the owning org's
// effective SRE connection to the stock OpenChoreo SRE agent, and has every
// save that can change that connection kick it. nil when cfg names no push
// target: the SRE agent is then not this server's to configure.
func newSREAgentReconciler(cfg config.Config, store secrets.CredentialStore,
	sreModels *organization.SreModelConnectionService, models *organization.ModelConnectionService) (*sreagent.Reconciler, error) {
	if !cfg.SREAgent.Enabled() {
		slog.Info("SRE agent reconciler disabled: no SRE_AGENT_ORG/NAMESPACE/DEPLOYMENT/SECRET push target")
		return nil, nil
	}
	if cfg.KubeAPI.BaseURL == "" {
		return nil, fmt.Errorf("sre agent reconciler: SRE_AGENT_* names a push target but no Kubernetes API is configured (KUBERNETES_SERVICE_HOST/PORT or KUBE_API_BASE_URL)")
	}
	kube, err := kubeobs.New(cfg.KubeAPI)
	if err != nil {
		return nil, fmt.Errorf("sre agent reconciler: %w", err)
	}
	rec := sreagent.NewReconciler(cfg.SREAgent, kube, sreModels.EffectiveSRE, sreagent.NewTokens(store))
	sreModels.OnChange(rec.Kick)
	models.OnChange(rec.Kick)
	slog.Info("SRE agent reconciler", "org", cfg.SREAgent.Org, "namespace", cfg.SREAgent.Namespace,
		"deployment", cfg.SREAgent.Deployment)
	return rec, nil
}
