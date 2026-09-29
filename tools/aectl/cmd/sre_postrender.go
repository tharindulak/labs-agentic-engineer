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
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

// The stock observability-plane chart exposes no extraVolumes for the SRE
// agent, so aectl adds what the agent needs to the rendered Deployment with a
// Helm post-renderer (`aectl sre post-render`, stdin -> stdout):
//
//   - the sre-agent-extensions ConfigMap at EXTENSIONS_DIR, laid out as the
//     remediation extension the agent's loader expects; and
//   - a CA bundle for SSL_CERT_FILE: the image's system bundle plus
//     cluster-gateway-ca, concatenated in-pod by an initContainer into an
//     emptyDir, so the agent trusts aep-mcp-server's https endpoint.
const (
	sreExtensionsVolume    = sreExtensionsConfigMap
	sreExtensionsMountPath = "/opt/aep/sre-agent-extensions"

	sreClusterCAVolume    = "cluster-gateway-ca"
	sreClusterCAMountPath = "/opt/aep/cluster-ca"
	sreCABundleVolume     = "aep-ca-bundle"
	sreCABundleMountPath  = "/opt/aep/ca"
	sreCABundleInit       = "aep-ca-bundle"

	// sreSystemCABundle is where the agent image keeps its system CA bundle
	// (the image's own SSL_CERT_FILE default).
	sreSystemCABundle = "/etc/ssl/certs/ca-certificates.crt"
)

// sreCABundleScript runs under the agent image's python (the image has no
// shell) and writes the merged bundle SSL_CERT_FILE points at.
var sreCABundleScript = fmt.Sprintf(
	"import pathlib as p; p.Path(%q).write_text(p.Path(%q).read_text() + '\\n' + p.Path(%q).read_text())",
	sreCABundleMountPath+"/ca-bundle.crt", sreSystemCABundle, sreClusterCAMountPath+"/ca.crt")

var srePostRenderComponent string

var srePostRenderCmd = &cobra.Command{
	Use:          "post-render",
	Short:        "Helm post-renderer: mount the SRE extensions and CA bundle into the SRE agent",
	Hidden:       true,
	SilenceUsage: true,
	Args:         cobra.NoArgs,
	// A pure stdin -> stdout transform: skip the root command's cluster setup.
	PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
	RunE: func(cmd *cobra.Command, _ []string) error {
		in, err := io.ReadAll(cmd.InOrStdin())
		if err != nil {
			return err
		}
		out, err := addExtensionsMount(in, srePostRenderComponent)
		if err != nil {
			return err
		}
		_, err = cmd.OutOrStdout().Write(out)
		return err
	},
}

func init() {
	sreCmd.AddCommand(srePostRenderCmd)
	srePostRenderCmd.Flags().StringVar(&srePostRenderComponent, "component", "sre-agent",
		"app.kubernetes.io/component label (and container name) of the SRE agent Deployment: the chart's rca.name")
}

var manifestSeparator = regexp.MustCompile(`(?m)^---[ \t]*\n?`)

// addExtensionsMount wires the extensions mount and the CA bundle into the
// Deployment labelled app.kubernetes.io/component=component, on its container
// of the same name. Other documents pass through verbatim. Idempotent. It
// fails when no such Deployment is in the stream, so a chart change that
// renames the agent cannot silently drop the mounts.
func addExtensionsMount(manifests []byte, component string) ([]byte, error) {
	var docs []string
	for _, d := range manifestSeparator.Split(string(manifests), -1) {
		if strings.TrimSpace(d) != "" {
			docs = append(docs, d)
		}
	}
	found := false
	for i, doc := range docs {
		var obj map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &obj); err != nil {
			return nil, fmt.Errorf("decode manifest %d: %w", i, err)
		}
		u := unstructured.Unstructured{Object: obj}
		if obj == nil || u.GetKind() != "Deployment" || u.GetLabels()["app.kubernetes.io/component"] != component {
			continue
		}
		if err := wireSREAgentDeployment(&u, component); err != nil {
			return nil, fmt.Errorf("deployment %s: %w", u.GetName(), err)
		}
		b, err := yaml.Marshal(u.Object)
		if err != nil {
			return nil, err
		}
		docs[i] = string(b)
		found = true
	}
	if !found {
		return nil, fmt.Errorf("no Deployment labelled app.kubernetes.io/component=%s in the rendered manifests", component)
	}
	var b strings.Builder
	for _, d := range docs {
		b.WriteString("---\n")
		b.WriteString(d)
		if !strings.HasSuffix(d, "\n") {
			b.WriteString("\n")
		}
	}
	return []byte(b.String()), nil
}

func wireSREAgentDeployment(u *unstructured.Unstructured, component string) error {
	raw, _, err := unstructured.NestedMap(u.Object, "spec", "template", "spec")
	if err != nil {
		return err
	}
	var spec corev1.PodSpec
	if err := convertJSON(raw, &spec); err != nil {
		return fmt.Errorf("decode pod spec: %w", err)
	}
	if err := wireSREAgentPod(&spec, component); err != nil {
		return err
	}
	var out map[string]interface{}
	if err := convertJSON(spec, &out); err != nil {
		return err
	}
	return unstructured.SetNestedMap(u.Object, out, "spec", "template", "spec")
}

func wireSREAgentPod(spec *corev1.PodSpec, component string) error {
	var agent *corev1.Container
	for i := range spec.Containers {
		if spec.Containers[i].Name == component {
			agent = &spec.Containers[i]
		}
	}
	if agent == nil {
		return fmt.Errorf("no container named %q", component)
	}

	optional := true
	// Optional: Helm renders the agent before `sre install` applies the
	// ConfigMap (then restarts the agent), and --ae-handoff=false never
	// applies it; neither may keep the pod from starting.
	addVolume(spec, corev1.Volume{Name: sreExtensionsVolume, VolumeSource: corev1.VolumeSource{
		ConfigMap: &corev1.ConfigMapVolumeSource{
			LocalObjectReference: corev1.LocalObjectReference{Name: sreExtensionsConfigMap},
			Optional:             &optional,
			Items: []corev1.KeyToPath{
				{Key: sreExtensionsKeyMCPJSON, Path: "remediation/mcp.json"},
				{Key: sreExtensionsKeyContext, Path: "remediation/CONTEXT.md"},
				{Key: sreExtensionsKeySkillMD, Path: "remediation/skills/coding-agent-handoff/SKILL.md"},
			},
		},
	}})
	addVolume(spec, corev1.Volume{Name: sreClusterCAVolume, VolumeSource: corev1.VolumeSource{
		ConfigMap: &corev1.ConfigMapVolumeSource{
			LocalObjectReference: corev1.LocalObjectReference{Name: sreClusterCAVolume},
			Items:                []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}},
		},
	}})
	addVolume(spec, corev1.Volume{Name: sreCABundleVolume, VolumeSource: corev1.VolumeSource{
		EmptyDir: &corev1.EmptyDirVolumeSource{},
	}})

	addMount(agent, corev1.VolumeMount{Name: sreExtensionsVolume, MountPath: sreExtensionsMountPath, ReadOnly: true})
	addMount(agent, corev1.VolumeMount{Name: sreCABundleVolume, MountPath: sreCABundleMountPath, ReadOnly: true})

	for _, c := range spec.InitContainers {
		if c.Name == sreCABundleInit {
			return nil
		}
	}
	spec.InitContainers = append(spec.InitContainers, corev1.Container{
		Name:            sreCABundleInit,
		Image:           agent.Image,
		ImagePullPolicy: agent.ImagePullPolicy,
		Command:         []string{"python", "-c", sreCABundleScript},
		SecurityContext: agent.SecurityContext.DeepCopy(),
		VolumeMounts: []corev1.VolumeMount{
			{Name: sreClusterCAVolume, MountPath: sreClusterCAMountPath, ReadOnly: true},
			{Name: sreCABundleVolume, MountPath: sreCABundleMountPath},
		},
	})
	return nil
}

func addVolume(spec *corev1.PodSpec, v corev1.Volume) {
	for _, existing := range spec.Volumes {
		if existing.Name == v.Name {
			return
		}
	}
	spec.Volumes = append(spec.Volumes, v)
}

func addMount(c *corev1.Container, m corev1.VolumeMount) {
	for _, existing := range c.VolumeMounts {
		if existing.Name == m.Name {
			return
		}
	}
	c.VolumeMounts = append(c.VolumeMounts, m)
}

// convertJSON converts between an unstructured map and a typed API object
// through their JSON form (YAML-decoded numbers are float64, which a direct
// unstructured conversion into int fields rejects).
func convertJSON(from, to interface{}) error {
	b, err := json.Marshal(from)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, to)
}
