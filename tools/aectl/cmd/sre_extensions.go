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

package cmd

import (
	"context"
	_ "embed"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// The remediation agent's SRE-agent extensions directory: the
// coding-agent-handoff skill (services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md,
// the single source of truth — already tested/pinned against the Go
// LabelSREAgent constant) plus the deployment-owned mcp.json/CONTEXT.md
// (deployments/sre-agent-extensions/remediation/). Embedded at build time
// since aectl is a standalone CLI that may run outside a checkout of this
// repo. See docs/design/draft/2026-09-17-sre-agent-extensions-handoff.md.
//
// These three files are VENDORED COPIES under sre_extensions_assets/, not a
// //go:embed of the originals above: go:embed patterns are flatly rejected
// (invalid pattern syntax) once they contain a ".." element, regardless of
// module boundaries — confirmed by hand (`go build` on a throwaway package
// with `//go:embed ../services/...`), not just inferred from the module
// layout. tools/aectl is its own Go module (tools/aectl/go.mod, listed in the
// root go.work), so there is no ascending path from tools/aectl/cmd that
// go:embed will accept.
//
// This mirrors the same workaround already used in this repo for the same
// problem: services/aep-api/internal/platform/designspec/*.schema.json and
// .../securityspec/*.schema.json are vendored copies of
// packages/contracts/schemas/*.schema.json, with an explicit doc-comment
// pointing back at the source of truth and manual re-syncing when the
// source changes (see git log for "re-sync the vendored ... schema"). If
// any of the three source files below change, re-copy them here in the same
// commit.
//
//go:embed sre_extensions_assets/SKILL.md
var handoffSkillMD string

//go:embed sre_extensions_assets/mcp.json
var remediationMCPJSONTemplate string

//go:embed sre_extensions_assets/CONTEXT.md
var remediationContextMD string

// readSecretValue reads one key out of a Secret, erroring clearly if the
// Secret or the key is missing (e.g. the aep-mcp-token ExternalSecret hasn't
// synced yet).
func readSecretValue(ctx context.Context, client *kubernetes.Clientset, ns, name, key string) (string, error) {
	sec, err := client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	v, ok := sec.Data[key]
	if !ok {
		return "", fmt.Errorf("secret %s/%s has no key %q", ns, name, key)
	}
	return string(v), nil
}

// applyExtensionsConfigMap writes the three mounted files as one ConfigMap.
// Keys are flat (ConfigMaps can't hold '/'), so the pod-side volume mount
// below maps each key back onto its EXTENSIONS_DIR subpath via `items`.
func applyExtensionsConfigMap(ctx context.Context, client *kubernetes.Clientset, ns, mcpJSON, contextMD, skillMD string) error {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "sre-agent-extensions", Namespace: ns},
		Data: map[string]string{
			"mcp.json":   mcpJSON,
			"CONTEXT.md": contextMD,
			"SKILL.md":   skillMD,
		},
	}
	if _, err := client.CoreV1().ConfigMaps(ns).Create(ctx, cm, metav1.CreateOptions{}); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return err
		}
		if _, err := client.CoreV1().ConfigMaps(ns).Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
			return err
		}
	}
	return nil
}

// mountExtensionsVolume patches deployName so the sre-agent-extensions
// ConfigMap lands at EXTENSIONS_DIR/remediation/{mcp.json,CONTEXT.md,skills/coding-agent-handoff/SKILL.md}
// (the agent's default EXTENSIONS_DIR, per src/config.py — no env var override
// needed). Idempotent: a strategic-merge patch on a volume/volumeMount by
// name is safe to re-apply.
//
// deployName is also used as the container name to patch: confirmed against
// the pulled openchoreo-observability-plane chart's own
// templates/ai-rca-agent/deployment.yaml, both the Deployment's metadata.name
// and its single container's name are `{{ .Values.rca.name }}`, which
// defaults to "ai-rca-agent" — i.e. the Deployment name and the container
// name are the same string here, unlike a chart where they could drift.
func mountExtensionsVolume(ctx context.Context, client *kubernetes.Clientset, ns, deployName string) error {
	patch := `{
		"spec": {"template": {"spec": {
			"volumes": [{
				"name": "sre-agent-extensions",
				"configMap": {
					"name": "sre-agent-extensions",
					"items": [
						{"key": "mcp.json", "path": "remediation/mcp.json"},
						{"key": "CONTEXT.md", "path": "remediation/CONTEXT.md"},
						{"key": "SKILL.md", "path": "remediation/skills/coding-agent-handoff/SKILL.md"}
					]
				}
			}],
			"containers": [{"name": "` + deployName + `", "volumeMounts": [
				{"name": "sre-agent-extensions", "mountPath": "/etc/openchoreo/sre-agent"}
			]}]
		}}}
	}`
	_, err := client.AppsV1().Deployments(ns).Patch(ctx, deployName, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}
