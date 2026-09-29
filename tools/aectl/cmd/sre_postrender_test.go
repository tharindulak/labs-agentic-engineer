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
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/yaml"
)

func TestAddExtensionsMount(t *testing.T) {
	in := []byte(`apiVersion: v1
kind: Service
metadata: {name: sre-agent}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sre-agent
  labels: {app.kubernetes.io/component: sre-agent}
spec:
  template:
    spec:
      containers:
        - name: sre-agent
          image: ghcr.io/openchoreo/sre-agent:v1.3.0
          securityContext: {runAsNonRoot: true, runAsUser: 12000}
          volumeMounts: [{name: auth-config, mountPath: /etc/openchoreo}]
      volumes: [{name: auth-config, configMap: {name: observer-auth-config}}]
`)
	out, err := addExtensionsMount(in, "sre-agent")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{
		"name: sre-agent-extensions", "mountPath: /opt/aep/sre-agent-extensions",
		"path: remediation/mcp.json", "path: remediation/CONTEXT.md", "path: remediation/skills/coding-agent-handoff/SKILL.md",
		"mountPath: /etc/openchoreo", "kind: Service",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q:\n%s", want, s)
		}
	}
	again, _ := addExtensionsMount(out, "sre-agent")
	if strings.Count(string(again), "name: sre-agent-extensions") != strings.Count(s, "name: sre-agent-extensions") {
		t.Error("must be idempotent")
	}
	if strings.Count(string(again), "name: aep-ca-bundle") != strings.Count(s, "name: aep-ca-bundle") {
		t.Error("CA bundle wiring must be idempotent")
	}
	if _, err := addExtensionsMount([]byte("kind: Service\n"), "sre-agent"); err == nil {
		t.Error("must fail when no SRE agent Deployment is rendered")
	}
}

// The agent's CA bundle is built in-pod: an initContainer on the agent's own
// image concatenates the image's system bundle with cluster-gateway-ca into an
// emptyDir, which the agent mounts read-only (SSL_CERT_FILE points into it).
func TestAddExtensionsMountBuildsCABundle(t *testing.T) {
	in := []byte(`---
# Source: openchoreo-observability-plane/templates/sre-agent/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sre-agent
  labels: {app.kubernetes.io/component: sre-agent}
spec:
  template:
    spec:
      containers:
        - name: sre-agent
          image: ghcr.io/openchoreo/sre-agent:v1.3.0
          securityContext: {runAsNonRoot: true, runAsUser: 12000, allowPrivilegeEscalation: false}
      volumes: []
`)
	out, err := addExtensionsMount(in, "sre-agent")
	if err != nil {
		t.Fatal(err)
	}
	spec := renderedPodSpec(t, out)

	vols := map[string]corev1.Volume{}
	for _, v := range spec.Volumes {
		vols[v.Name] = v
	}
	// Helm renders the agent before step 7 applies the extensions ConfigMap
	// (and --ae-handoff=false never applies it): the agent must still start.
	if v := vols["sre-agent-extensions"]; v.ConfigMap == nil || v.ConfigMap.Optional == nil || !*v.ConfigMap.Optional {
		t.Errorf("sre-agent-extensions must be an optional ConfigMap volume, got %+v", v)
	}
	if v := vols["cluster-gateway-ca"]; v.ConfigMap == nil || v.ConfigMap.Name != "cluster-gateway-ca" ||
		len(v.ConfigMap.Items) != 1 || v.ConfigMap.Items[0].Key != "ca.crt" {
		t.Errorf("cluster-gateway-ca volume = %+v", v)
	}
	if v := vols["aep-ca-bundle"]; v.EmptyDir == nil {
		t.Errorf("aep-ca-bundle must be an emptyDir, got %+v", v)
	}

	if len(spec.InitContainers) != 1 {
		t.Fatalf("want one initContainer, got %d", len(spec.InitContainers))
	}
	ic := spec.InitContainers[0]
	main := spec.Containers[0]
	if ic.Name != "aep-ca-bundle" || ic.Image != main.Image {
		t.Errorf("initContainer %q image %q, want aep-ca-bundle on %q", ic.Name, ic.Image, main.Image)
	}
	if len(ic.Command) != 3 || ic.Command[0] != "python" || ic.Command[1] != "-c" {
		t.Fatalf("initContainer command = %q, want python -c <script>", ic.Command)
	}
	for _, want := range []string{"/etc/ssl/certs/ca-certificates.crt", "/opt/aep/cluster-ca/ca.crt", "/opt/aep/ca/ca-bundle.crt"} {
		if !strings.Contains(ic.Command[2], want) {
			t.Errorf("script missing %q: %s", want, ic.Command[2])
		}
	}
	if ic.SecurityContext == nil || ic.SecurityContext.RunAsUser == nil || *ic.SecurityContext.RunAsUser != 12000 {
		t.Errorf("initContainer must inherit the agent's securityContext, got %+v", ic.SecurityContext)
	}
	wantMounts(t, ic.VolumeMounts, map[string]string{"cluster-gateway-ca": "/opt/aep/cluster-ca", "aep-ca-bundle": "/opt/aep/ca"})
	if m := mountNamed(ic.VolumeMounts, "cluster-gateway-ca"); m == nil || !m.ReadOnly {
		t.Error("cluster-gateway-ca must be mounted read-only in the initContainer")
	}
	wantMounts(t, main.VolumeMounts, map[string]string{"aep-ca-bundle": "/opt/aep/ca", "sre-agent-extensions": "/opt/aep/sre-agent-extensions"})
	for _, name := range []string{"aep-ca-bundle", "sre-agent-extensions"} {
		if m := mountNamed(main.VolumeMounts, name); m == nil || !m.ReadOnly {
			t.Errorf("%s must be mounted read-only on the agent", name)
		}
	}

	again, err := addExtensionsMount(out, "sre-agent")
	if err != nil {
		t.Fatal(err)
	}
	if spec2 := renderedPodSpec(t, again); len(spec2.InitContainers) != 1 || len(spec2.Volumes) != len(spec.Volumes) ||
		len(spec2.Containers[0].VolumeMounts) != len(main.VolumeMounts) {
		t.Error("a second pass must not add anything")
	}
}

func renderedPodSpec(t *testing.T, manifests []byte) corev1.PodSpec {
	t.Helper()
	var d struct {
		Spec struct {
			Template struct {
				Spec corev1.PodSpec `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := yaml.Unmarshal(manifests, &d); err != nil {
		t.Fatalf("decode rendered Deployment: %v\n%s", err, manifests)
	}
	return d.Spec.Template.Spec
}

func mountNamed(ms []corev1.VolumeMount, name string) *corev1.VolumeMount {
	for i := range ms {
		if ms[i].Name == name {
			return &ms[i]
		}
	}
	return nil
}

func wantMounts(t *testing.T, ms []corev1.VolumeMount, want map[string]string) {
	t.Helper()
	for name, path := range want {
		if m := mountNamed(ms, name); m == nil || m.MountPath != path {
			t.Errorf("mount %s: got %+v, want at %s", name, m, path)
		}
	}
}
