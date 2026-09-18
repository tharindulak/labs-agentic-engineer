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
	"fmt"
	"os"
	"path/filepath"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

type sreExtensionAssets struct {
	MCPJSON  string
	Context  string
	SkillMD  string
	RootHint string
}

func loadSreExtensionAssets() (sreExtensionAssets, error) {
	root, err := findRepoRootForSREAssets()
	if err != nil {
		return sreExtensionAssets{}, err
	}
	read := func(rel string) (string, error) {
		b, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	mcpJSON, err := read("deployments/sre-agent-extensions/remediation/mcp.json")
	if err != nil {
		return sreExtensionAssets{}, fmt.Errorf("read remediation mcp.json: %w", err)
	}
	contextMD, err := read("deployments/sre-agent-extensions/remediation/CONTEXT.md")
	if err != nil {
		return sreExtensionAssets{}, fmt.Errorf("read remediation CONTEXT.md: %w", err)
	}
	skillMD, err := read("services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md")
	if err != nil {
		return sreExtensionAssets{}, fmt.Errorf("read coding-agent-handoff skill: %w", err)
	}
	return sreExtensionAssets{MCPJSON: mcpJSON, Context: contextMD, SkillMD: skillMD, RootHint: root}, nil
}

func findRepoRootForSREAssets() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "deployments/sre-agent-extensions/remediation/mcp.json")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "services/aep-mcp-server/skills/coding-agent-handoff/SKILL.md")); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	return "", fmt.Errorf("could not locate AE repository root containing SRE extension assets from %s", wd)
}

func applyExtensionsConfigMap(ctx context.Context, client kubernetes.Interface, ns string, assets sreExtensionAssets) error {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "sre-agent-extensions", Namespace: ns},
		Data: map[string]string{
			"mcp.json":   assets.MCPJSON,
			"CONTEXT.md": assets.Context,
			"SKILL.md":   assets.SkillMD,
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

func mountSREAgentRuntime(ctx context.Context, client kubernetes.Interface, ns, deployName string) error {
	patch := `{
		"spec": {"template": {"spec": {
			"volumes": [
				{
					"name": "sre-agent-extensions",
					"configMap": {
						"name": "sre-agent-extensions",
						"items": [
							{"key": "mcp.json", "path": "remediation/mcp.json"},
							{"key": "CONTEXT.md", "path": "remediation/CONTEXT.md"},
							{"key": "SKILL.md", "path": "remediation/skills/coding-agent-handoff/SKILL.md"}
						]
					}
				},
				{
					"name": "anthropic-key",
					"secret": {
						"secretName": "rca-agent-anthropic-secret",
						"optional": true,
						"defaultMode": 256
					}
				}
			],
			"containers": [{
				"name": "` + deployName + `",
				"volumeMounts": [
					{"name": "sre-agent-extensions", "mountPath": "/etc/openchoreo/sre-agent", "readOnly": true},
					{"name": "anthropic-key", "mountPath": "/etc/rca-agent/anthropic", "readOnly": true}
				],
				"env": [
					{"name": "EXTENSIONS_DIR", "value": "/etc/openchoreo/sre-agent"},
					{"name": "RCA_LLM_API_KEY_FILE", "value": "/etc/rca-agent/anthropic/RCA_LLM_API_KEY"},
					{"name": "AEP_MCP_URL", "value": "http://aep-mcp-server.` + sreNamespace + `.svc.cluster.local:3400/mcp"},
					{"name": "AEP_MCP_TOKEN", "valueFrom": {"secretKeyRef": {"name": "aep-mcp-token", "key": "AEP_MCP_TOKEN", "optional": true}}}
				]
			}]
		}}}
	}`
	_, err := client.AppsV1().Deployments(ns).Patch(ctx, deployName, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}
