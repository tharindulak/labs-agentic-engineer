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
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"

	k8s "github.com/wso2/aep/aectl/internal/kubernetes"
	"github.com/wso2/aep/aectl/internal/ui"
)

// SRE (RCA) agent install. Brings the OpenChoreo Observability Plane + SRE/RCA
// agent up to parity with the local docker-compose path
// (deployments/scripts/setup-observability.sh), adapted for the in-cluster Helm
// install: secrets flow OpenBao->ESO (never plaintext), and the RCA->AEP handoff
// targets in-cluster Service DNS instead of host.k3d.internal.
//
// Prerequisite: `aectl init` must have run first (it registers the
// openchoreo-rca-agent Thunder client and seeds the OpenBao secrets this reads).

var (
	sreNamespace       string // where AEP + OpenBao live (secret source)
	sreObsNamespace    string // observability plane namespace
	sreOpenBaoAddr     string
	sreObsPlaneVersion string
	sreObsLogsVersion  string
	sreRcaImageRepo    string
	sreRcaImageTag     string
	sreRcaPullPolicy   string
	sreRcaModel        string
	sreAdapterImage    string
	sreAEHandoff       bool
	sreObserverHost    string
	sreRcaHost         string
	sreAEPMcpHost      string
)

var sreCmd = &cobra.Command{
	Use:   "sre",
	Short: "Manage the SRE (RCA) agent + observability plane",
}

var sreInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install the observability plane + SRE/RCA agent and wire the AEP handoff",
	Long: `Detects the OpenChoreo Observability Plane and SRE/RCA agent; warns and
installs them if missing (idempotent), then applies the AEP integration:
obs-namespace secrets (via OpenBao/ESO), the alert->RCA auto-trigger + AEP
handoff wiring, the authz grants, and the observability CRs.

Run 'aectl init' first — it registers the openchoreo-rca-agent Thunder client and
seeds the OpenBao secrets this command reads via External Secrets.`,
	RunE: runSreInstall,
}

func init() {
	rootCmd.AddCommand(sreCmd)
	sreCmd.AddCommand(sreInstallCmd)

	f := sreInstallCmd.Flags()
	f.StringVar(&sreNamespace, "namespace", "wso2-aep", "Namespace where AEP + OpenBao are installed")
	f.StringVar(&sreObsNamespace, "obs-namespace", "openchoreo-observability-plane", "Observability plane namespace")
	f.StringVar(&sreOpenBaoAddr, "openbao-addr", "http://openbao.openbao.svc.cluster.local:8200", "In-cluster OpenBao address for the obs-namespace SecretStore")
	f.StringVar(&sreObsPlaneVersion, "obs-plane-version", "1.0.1-hotfix.1", "openchoreo-observability-plane chart version")
	f.StringVar(&sreObsLogsVersion, "obs-logs-version", "0.5.1", "observability-logs-opensearch chart version")
	// Vanilla OpenChoreo image: ghcr.io/openchoreo/ai-rca-agent (the repo the
	// chart's own values.yaml defaults to — confirmed against the pulled
	// openchoreo-observability-plane chart), tag pinned to the chart's own
	// AppVersion (Chart.yaml) for the obs-plane-version default below
	// (1.0.1-hotfix.1) — the same release the observability-plane chart
	// resolves to when rca.image.tag is left empty, and, per OpenChoreo PR
	// #4743 (merged well before this hotfix release), carries the generic
	// EXTENSIONS_DIR mechanism this task wires into. Replaces the
	// tharindulak/sre-agent fork, which existed only to carry the
	// bespoke HANDOFF_* config this task retires.
	//
	// tharindulak/sre-agent:v1.0.1-hotfix.1-anthropic is the DEFAULT here
	// instead, temporarily: the vanilla image's pyproject.toml/uv.lock never
	// declare langchain-anthropic, so init_chat_model("anthropic:...")
	// fails at runtime, and AEP's own RCA config (RCA_LLM_API_KEY sourced
	// from aep/anthropic-api-key, model default anthropic:claude-sonnet-4-6)
	// is Anthropic-only. This tag is the same v1.0.1-hotfix.1 base rebuilt
	// with only langchain-anthropic added to pyproject.toml/uv.lock and the
	// ToolStrategy-for-Anthropic branch in agent.py (the change already
	// merged upstream as commit 43efc190 on a since-superseded branch,
	// re-applied here rather than cherry-picked because that commit's
	// uv.lock has drifted from current upstream). Revert this default to
	// ghcr.io/openchoreo/ai-rca-agent once upstream OpenChoreo carries
	// Anthropic support (or once AEP switches its own RCA model config to a
	// provider the vanilla image already supports, e.g. OpenAI).
	f.StringVar(&sreRcaImageRepo, "rca-image-repo", "tharindulak/sre-agent", "RCA/SRE agent image repository")
	f.StringVar(&sreRcaImageTag, "rca-image-tag", "v1.0.1-hotfix.1-anthropic", "RCA/SRE agent image tag")
	f.StringVar(&sreRcaPullPolicy, "rca-image-pull-policy", "IfNotPresent", "RCA/SRE agent image pull policy")
	f.StringVar(&sreRcaModel, "rca-model", "anthropic:claude-sonnet-4-6", "RCA/SRE agent LLM model")
	f.StringVar(&sreAdapterImage, "adapter-image", "docker.io/tharindulak/observability-logs-opensearch-adapter:0.5.1-case-insensitive", "logs-adapter image (repo:tag)")
	f.BoolVar(&sreAEHandoff, "ae-handoff", true, "Enable the RCA->AEP coding-agent handoff (mounts mcp.json/CONTEXT.md/skill at EXTENSIONS_DIR)")
	f.StringVar(&sreObserverHost, "observer-hostname", "observer.openchoreo.localhost", "Observer gateway hostname")
	f.StringVar(&sreRcaHost, "rca-hostname", "rca-agent.openchoreo.localhost", "RCA agent gateway hostname")
	// :8443, not the bare hostname: every other *.openchoreo.localhost https
	// URL in this repo carries this port explicitly (see
	// deployments/design/two-tier-thunder.md) — the control-plane gateway's
	// httpsPort, not the implicit 443 nothing listens on locally.
	f.StringVar(&sreAEPMcpHost, "aep-mcp-hostname", "aep-mcp.openchoreo.localhost:8443", "aep-mcp-server gateway hostname (used by the remediation agent's mcp.json)")
	f.String("oc-api-url", "", "In-cluster OpenChoreo platform API URL (overrides config)")
	_ = viper.BindPFlag("oc.api_url", f.Lookup("oc-api-url"))
}

// sreParams holds everything the value/manifest templates need.
type sreParams struct {
	ObsNamespace, OpenBaoAddr                                 string
	OCApiURL, ThunderJwksURL, ThunderTokenURL, ThunderAuthURL string
	RcaImageRepo, RcaImageTag, RcaPullPolicy, RcaModel        string
	AdapterRepo, AdapterTag                                   string
	ObserverHost, RcaHost, AEPMcpHost                         string
	// AEPNamespace is the AEP namespace (sreNamespace) — where aep-api,
	// aep-mcp-server, and their aep-mcp-token ExternalSecret live. Needed here
	// (not just as the standalone sreNamespace var) because sreCRsTmpl's
	// aep-mcp-mainkgw HTTPRoute and sreAEPNamespaceCRsTmpl's ReferenceGrant
	// both cross from ObsNamespace into it.
	AEPNamespace string
	// RcaServiceURL is in-cluster Service DNS (not host.k3d.internal) — where
	// the observer's alert->RCA auto-trigger posts.
	RcaServiceURL string
}

func runSreInstall(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	if _, err := exec.LookPath("helm"); err != nil {
		return fmt.Errorf("helm is required but was not found in PATH\nInstall it from https://helm.sh/docs/intro/install/ and try again")
	}

	client, err := k8s.NewClient(kubeconfig)
	if err != nil {
		return fmt.Errorf("connect to cluster: %w", err)
	}
	applier, err := k8s.NewApplier(kubeconfig)
	if err != nil {
		return fmt.Errorf("build applier: %w", err)
	}

	thunderURL := viper.GetString("thunder.url")
	p := sreParams{
		ObsNamespace:    sreObsNamespace,
		OpenBaoAddr:     sreOpenBaoAddr,
		OCApiURL:        viper.GetString("oc.api_url"),
		ThunderJwksURL:  thunderURL + "/oauth2/jwks",
		ThunderTokenURL: thunderURL + "/oauth2/token",
		ThunderAuthURL:  viper.GetString("thunder.public_url"),
		RcaImageRepo:    sreRcaImageRepo,
		RcaImageTag:     sreRcaImageTag,
		RcaPullPolicy:   sreRcaPullPolicy,
		RcaModel:        sreRcaModel,
		ObserverHost:    sreObserverHost,
		RcaHost:         sreRcaHost,
		AEPMcpHost:      sreAEPMcpHost,
		AEPNamespace:    sreNamespace,
		RcaServiceURL:   "http://ai-rca-agent:8080",
	}
	// Split on the LAST colon so a registry port (registry:5000/img:tag) is
	// kept in the repo; image tags never contain a colon.
	if i := strings.LastIndex(sreAdapterImage, ":"); i > 0 && i < len(sreAdapterImage)-1 {
		p.AdapterRepo, p.AdapterTag = sreAdapterImage[:i], sreAdapterImage[i+1:]
	} else {
		return fmt.Errorf("--adapter-image must be repo:tag, got %q", sreAdapterImage)
	}

	// 1. Detect + warn.
	if _, err := client.AppsV1().Deployments(sreObsNamespace).Get(ctx, "observer", metav1.GetOptions{}); err != nil {
		if apierrors.IsNotFound(err) {
			ui.Warn(fmt.Sprintf("Observability plane not found in namespace %q — installing it now.", sreObsNamespace))
		}
	} else {
		ui.Detail(fmt.Sprintf("Observability plane detected in %q — reconciling (idempotent upgrade).", sreObsNamespace))
	}

	// 2. Namespace + cluster-gateway-ca + secrets via OpenBao->ESO.
	if err := ensureNamespace(ctx, client, sreObsNamespace); err != nil {
		return err
	}
	// The obs-plane chart mounts a cluster-gateway-ca ConfigMap into its
	// cluster-agent pod but does not create it (same as the DP/WF planes).
	// Without it the cluster-agent sits in ContainerCreating forever.
	if err := ensureClusterGatewayCA(ctx, client, sreObsNamespace); err != nil {
		return fmt.Errorf("cluster-gateway-ca: %w", err)
	}
	ui.Step("Applying obs-namespace SecretStore + ExternalSecrets (OpenBao->ESO)")
	if err := applyTemplate(ctx, applier, "sre-secrets", sreObsNamespace, sreSecretsTmpl, p); err != nil {
		return fmt.Errorf("apply secrets: %w (did you run `aectl init`?)", err)
	}
	// ESO must materialise the OpenSearch creds before the charts start.
	// aep-mcp-token deliberately is NOT in this list: unlike the three below,
	// aectl init does not yet seed its OpenBao path (aep/aep-mcp-token — see
	// the comment above that ExternalSecret in sre_assets.go), so waiting for
	// it here would hard-fail every `aectl sre install` run after a 2-minute
	// timeout on a feature that is off-by-default and optional. Its
	// consumers (the RCA pod's extraEnvs, below) tolerate it being absent via
	// optional: true instead.
	for _, s := range []string{"opensearch-admin-credentials", "rca-agent-secret", "observer-secret"} {
		if err := waitForSecret(ctx, client, sreObsNamespace, s, 2*time.Minute); err != nil {
			return fmt.Errorf("%w\nESO did not sync %q — check the SecretStore/ExternalSecrets and that `aectl init` seeded OpenBao", err, s)
		}
	}
	ui.Success("Secrets synced")

	// 3. Helm install the two OpenChoreo charts.
	if err := helmInstallObsPlane(ctx, p); err != nil {
		return err
	}
	if err := helmInstallObsLogs(ctx, p); err != nil {
		return err
	}

	// 4. Best-effort readiness (do NOT wait on ai-rca-agent — it stays
	// unwired until step 5). Warn (don't abort) so name/version drift in the
	// upstream charts can't wedge the install.
	waitForDeployment(ctx, client, sreObsNamespace, "observer", 5*time.Minute)
	waitForDeployment(ctx, client, sreObsNamespace, "controller-manager", 5*time.Minute)

	// 5. Alert->RCA auto-trigger + AEP handoff wiring (post-helm ConfigMap
	// patches; the charts don't expose all these keys). In-cluster URLs.
	ui.Step("Wiring alert->RCA auto-trigger + AEP handoff")
	if err := patchConfigMap(ctx, client, sreObsNamespace, "observer-config", map[string]string{
		"LOGS_ADAPTER_ENABLED":     "true",
		"RCA_SERVICE_URL":          p.RcaServiceURL,
		"ALERT_SUPPRESSION_WINDOW": "1h",
	}); err != nil {
		return err
	}
	_ = rolloutRestart(ctx, client, sreObsNamespace, "observer")
	if sreAEHandoff {
		ui.Step("Wiring the remediation agent's SRE-agent extensions (mcp.json/CONTEXT.md/skill)")
		extAEPMcpToken, err := readSecretValue(ctx, client, sreObsNamespace, "aep-mcp-token", "AEP_MCP_TOKEN")
		if err != nil {
			return fmt.Errorf("read aep-mcp-token secret: %w (did step 2's ExternalSecret sync?)", err)
		}
		renderedMCPJSON := strings.NewReplacer(
			"${AEP_MCP_HOSTNAME}", p.AEPMcpHost,
			"${AEP_MCP_TOKEN}", extAEPMcpToken,
		).Replace(remediationMCPJSONTemplate)
		if err := applyExtensionsConfigMap(ctx, client, sreObsNamespace, renderedMCPJSON, remediationContextMD, handoffSkillMD); err != nil {
			return fmt.Errorf("apply sre-agent-extensions configmap: %w", err)
		}
		if err := mountExtensionsVolume(ctx, client, sreObsNamespace, "ai-rca-agent"); err != nil {
			return fmt.Errorf("mount sre-agent-extensions onto ai-rca-agent: %w", err)
		}
		_ = rolloutRestart(ctx, client, sreObsNamespace, "ai-rca-agent")
		ui.Detail("AE handoff: mcp.json + CONTEXT.md + coding-agent-handoff skill mounted at EXTENSIONS_DIR")
	} else {
		ui.Detail("AE handoff: disabled (--ae-handoff=false)")
	}

	// 6. Authz grants + routes + ClusterObservabilityPlane CR.
	ui.Step("Applying authz grants, HTTPRoute, and ClusterObservabilityPlane")
	if err := applyTemplate(ctx, applier, "sre-crs", sreObsNamespace, sreCRsTmpl, p); err != nil {
		return fmt.Errorf("apply CRs: %w", err)
	}
	// aep-mcp-mainkgw's backendRef (above) reaches across into the AEP
	// namespace for the aep-mcp-server Service; Gateway API requires that
	// namespace to explicitly permit it via a ReferenceGrant. Applied here,
	// into sreNamespace (not sreObsNamespace) — this repo's own platform Helm
	// chart, which owns that namespace, has no notion of the obs namespace's
	// name, so this cross-cutting CR is aectl's to apply, not the chart's.
	if err := applyTemplate(ctx, applier, "sre-aep-ns-crs", sreNamespace, sreAEPNamespaceCRsTmpl, p); err != nil {
		return fmt.Errorf("apply AEP-namespace ReferenceGrant: %w", err)
	}

	// 7. OpenSearch index-template bootstrap (detect + self-heal).
	ui.Step("Running OpenSearch index-template bootstrap job")
	if err := k8s.RunJob(ctx, client, openSearchBootstrapJob(sreObsNamespace), os.Stdout); err != nil {
		ui.Warn(fmt.Sprintf("index-template bootstrap job did not complete cleanly: %v", err))
		ui.Detail("Log-based alerts may misbehave until the container-logs template maps log as 'wildcard'.")
	}

	printSreCompletion()
	return nil
}

func printSreCompletion() {
	ui.Success("SRE agent + observability plane installed")
	ui.Section("Security Note")
	ui.Detail(fmt.Sprintf("AE handoff is %s. A fired alert whose RCA finds a root cause files a", onOff(sreAEHandoff)))
	ui.Detail("coding-agent issue from LLM-driven analysis; AEP's own classification (not")
	ui.Detail("this installer) decides code_level/config_level and dispatch. Set")
	ui.Detail("--ae-handoff=false to disable filing entirely.")
	ui.Detail("RCA feeds pod logs to an LLM (prompt-injection surface).")
	ui.Detail("RCA/logs-adapter images are non-WSO2 registries (pin/mirror for prod).")
	ui.Section("Next Steps")
	ui.Detail("Create an ObservabilityAlertRule per component you want auto-RCA on")
	ui.Detail("(component UID + name labels, incident.enabled, triggerAiRca: true).")
	ui.Detail("Guide: docs/developer-guide/sre-handoff-runbook.md")
	fmt.Println()
}

func onOff(b bool) string {
	if b {
		return "ON"
	}
	return "OFF"
}

// ── helpers ──────────────────────────────────────────────────────────────────

func applyTemplate(ctx context.Context, applier *k8s.Applier, fieldManager, ns, tmpl string, p sreParams) error {
	t, err := template.New(fieldManager).Parse(tmpl)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, p); err != nil {
		return err
	}
	return applier.ApplyYAML(ctx, "aectl-sre", ns, buf.String())
}

// ensureClusterGatewayCA copies the cluster gateway CA cert from the
// control-plane's cluster-gateway-ca Secret into a same-named ConfigMap in the
// obs namespace (mirrors setup scripts' create_plane_cert_resources). The
// obs-plane chart's cluster-agent mounts this but does not create it.
func ensureClusterGatewayCA(ctx context.Context, client *kubernetes.Clientset, ns string) error {
	const cpNamespace = "openchoreo-control-plane"
	sec, err := client.CoreV1().Secrets(cpNamespace).Get(ctx, "cluster-gateway-ca", metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("read cluster-gateway-ca secret in %s: %w", cpNamespace, err)
	}
	ca := sec.Data["ca.crt"]
	if len(ca) == 0 {
		return fmt.Errorf("cluster-gateway-ca secret in %s has no ca.crt", cpNamespace)
	}
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "cluster-gateway-ca", Namespace: ns},
		Data:       map[string]string{"ca.crt": string(ca)},
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

func ensureNamespace(ctx context.Context, client *kubernetes.Clientset, ns string) error {
	_, err := client.CoreV1().Namespaces().Get(ctx, ns, metav1.GetOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	_, err = client.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: ns},
	}, metav1.CreateOptions{})
	if err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create namespace %s: %w", ns, err)
	}
	return nil
}

func waitForSecret(ctx context.Context, client *kubernetes.Clientset, ns, name string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if _, err := client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for secret %s/%s", ns, name)
		}
		time.Sleep(3 * time.Second)
	}
}

// waitForDeployment is best-effort: it warns on timeout rather than failing,
// since upstream chart resource names can drift across versions.
func waitForDeployment(ctx context.Context, client *kubernetes.Clientset, ns, name string, timeout time.Duration) {
	sp := ui.NewSpinner(fmt.Sprintf("Waiting for deployment/%s", name))
	sp.Start()
	deadline := time.Now().Add(timeout)
	for {
		d, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err == nil && d.Status.AvailableReplicas >= 1 {
			sp.Success(fmt.Sprintf("%s available", name))
			return
		}
		if time.Now().After(deadline) {
			sp.Stop()
			ui.Warn(fmt.Sprintf("%s not Available within %s — continuing (check it manually)", name, timeout))
			return
		}
		time.Sleep(5 * time.Second)
	}
}

func patchConfigMap(ctx context.Context, client *kubernetes.Clientset, ns, name string, data map[string]string) error {
	var b strings.Builder
	b.WriteString(`{"data":{`)
	first := true
	for k, v := range data {
		if !first {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, "%q:%q", k, v)
		first = false
	}
	b.WriteString("}}")
	if _, err := client.CoreV1().ConfigMaps(ns).Patch(ctx, name, types.MergePatchType, []byte(b.String()), metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("patch configmap %s/%s: %w", ns, name, err)
	}
	return nil
}

func rolloutRestart(ctx context.Context, client *kubernetes.Clientset, ns, name string) error {
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"aectl.wso2.com/restartedAt":%q}}}}}`,
		time.Now().UTC().Format(time.RFC3339))
	_, err := client.AppsV1().Deployments(ns).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

func helmInstallObsPlane(ctx context.Context, p sreParams) error {
	vals, cleanup, err := writeTempValues("obs-plane", sreObsPlaneValuesTmpl, p)
	if err != nil {
		return err
	}
	defer cleanup()
	args := []string{
		"upgrade", "--install", "observability-plane",
		"oci://ghcr.io/openchoreo/helm-charts/openchoreo-observability-plane",
		"--namespace", p.ObsNamespace, "--create-namespace",
		"--version", sreObsPlaneVersion,
		"--values", vals, "--timeout", "10m",
	}
	// --force-conflicts is a Helm v4 (server-side apply) flag; v3 rejects it as
	// unknown. It only matters on re-runs where the post-helm ConfigMap patches
	// (step 5) claimed chart-owned fields under a different field manager — a
	// v4-only concern. Add it only when the installed helm supports it.
	args = append(args, helmForceConflictsArgs(ctx)...)
	return runHelm(ctx, "obs-plane", args...)
}

// helmForceConflictsArgs returns ["--force-conflicts"] when the installed helm
// is v4+, else nil. Best-effort: on any parse error it returns nil (safe — v3
// behaviour needs no such flag).
func helmForceConflictsArgs(ctx context.Context) []string {
	out, err := exec.CommandContext(ctx, "helm", "version", "--short").Output()
	if err != nil {
		return nil
	}
	v := strings.TrimPrefix(strings.TrimSpace(string(out)), "v")
	major, _, _ := strings.Cut(v, ".")
	if n, err := strconv.Atoi(major); err == nil && n >= 4 {
		return []string{"--force-conflicts"}
	}
	return nil
}

func helmInstallObsLogs(ctx context.Context, p sreParams) error {
	vals, cleanup, err := writeTempValues("obs-logs", sreObsLogsValuesTmpl, p)
	if err != nil {
		return err
	}
	defer cleanup()
	return runHelm(ctx, "obs-logs",
		"upgrade", "--install", "observability-logs-opensearch",
		"oci://ghcr.io/openchoreo/helm-charts/observability-logs-opensearch",
		"--namespace", p.ObsNamespace, "--create-namespace",
		"--version", sreObsLogsVersion,
		"--values", vals, "--timeout", "15m")
}

func runHelm(ctx context.Context, label string, args ...string) error {
	ui.Step(fmt.Sprintf("Installing %s chart", label))
	var out bytes.Buffer
	c := exec.CommandContext(ctx, "helm", args...)
	c.Stdout = &out
	c.Stderr = &out
	if err := c.Run(); err != nil {
		return fmt.Errorf("helm %s: %w\n%s", label, err, out.String())
	}
	ui.Success(fmt.Sprintf("%s chart installed", label))
	return nil
}

func writeTempValues(prefix, tmpl string, p sreParams) (string, func(), error) {
	t, err := template.New(prefix).Parse(tmpl)
	if err != nil {
		return "", nil, err
	}
	f, err := os.CreateTemp("", "aectl-"+prefix+"-*.yaml")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { _ = os.Remove(f.Name()) }
	if err := t.Execute(f, p); err != nil {
		_ = f.Close()
		cleanup()
		return "", nil, err
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	return f.Name(), cleanup, nil
}

// openSearchBootstrapJob mirrors setup-observability.sh step 6: verify the
// container-logs index template maps `log` as wildcard and delete any indices
// created with a wrong mapping so they get recreated correctly.
func openSearchBootstrapJob(ns string) *batchv1.Job {
	backoff := int32(5)
	ttl := int32(600)
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "opensearch-bootstrap-templates", Namespace: ns},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyOnFailure,
					Containers: []corev1.Container{{
						Name:  "bootstrap",
						Image: "curlimages/curl:8.10.1",
						Env: []corev1.EnvVar{
							{Name: "OS_HOST", Value: "opensearch"},
							{Name: "OS_PORT", Value: "9200"},
							{Name: "OS_USER", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
								LocalObjectReference: corev1.LocalObjectReference{Name: "opensearch-admin-credentials"}, Key: "username"}}},
							{Name: "OS_PASS", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
								LocalObjectReference: corev1.LocalObjectReference{Name: "opensearch-admin-credentials"}, Key: "password"}}},
						},
						Command: []string{"/bin/sh", "-c"},
						Args:    []string{openSearchBootstrapScript},
					}},
				},
			},
		},
	}
}
