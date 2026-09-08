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

package ops

// The handoff classification, in this contract's spelling. The SRE agent's own
// enum spells them with underscores; createreport/native.go normalises reports
// on the way in, and the issue-create path answers in the spelling below.
const (
	ClassificationCodeLevel   = "code-level"
	ClassificationConfigLevel = "config-level"
	ClassificationMixed       = "mixed"
	ClassificationNone        = "none"
)

// settledStatuses need nothing further from anybody. Anything else — including a
// status that is absent or one nobody here recognises — is pending work.
var settledStatuses = map[string]bool{
	"revised":   true,
	"applied":   true,
	"dismissed": true,
}

// ClassifyActions reads the handoff classification off the remediation agent's
// own action statuses. No model input reaches it: remediation already decided
// code-versus-config per action — `revised` means it expressed the action as an
// OpenChoreo ReleaseBinding change, `suggested` means it could not — and asking
// a model to restate that put it in a position to contradict the data it was
// handed.
//
// An absent status is PENDING, not settled. Remediation did not run, so there is
// no upstream determination to read, and the asymmetry of being wrong decides
// the tie: an unfiled defect is dropped for good, while an unnecessary issue is
// closed in minutes. The remediation stage is off by default, so this is the
// ordinary case on a fresh install, not an edge one.
//
// It therefore DIFFERS DELIBERATELY from createreport's splitActions, which
// drops a status it does not recognise because escalating on an action nobody
// classified would file work off a status the remediation agent never asserted.
// That rule runs AFTER the handoff, as a backstop, where the bias belongs the
// other way. The two must not be collapsed into one — see
// TestClassifyActionsDisagreesWithSplitActionsOnAbsentStatus.
//
// Statuses arrive as pointers because the contract makes the items nullable: a
// nil entry is an action the remediation agent never reached, and it lands in
// the pending arm exactly as an omitted status should. An empty list is the one
// input that means "no actions", which is why callers must send one entry per
// action rather than filtering the nils out.
func ClassifyActions(statuses []*string) string {
	if len(statuses) == 0 {
		return ClassificationNone
	}
	pending := false
	configHandled := false
	for _, status := range statuses {
		value := ""
		if status != nil {
			value = *status
		}
		if !settledStatuses[value] {
			pending = true
		}
		if value == "revised" {
			configHandled = true
		}
	}
	if !pending {
		if configHandled {
			return ClassificationConfigLevel
		}
		return ClassificationNone
	}
	if configHandled {
		return ClassificationMixed
	}
	return ClassificationCodeLevel
}

// AdoptableClassification says whether an issue filed for this classification
// should be handed to a coding agent.
//
// Only `config-level` is withheld, and it is still FILED: configuration already
// expressed every action, so a coding agent has nothing to do, but the incident
// is worth a ledger entry somebody can find. Everything else is adopted,
// `none` included — a report that reached this point carries an identified root
// cause, and an unnecessary coding task is closed in minutes while a missed
// defect is permanent.
func AdoptableClassification(classification string) bool {
	return classification != ClassificationConfigLevel
}

// configDedupeSuffix namespaces a config-handled filing away from code-level
// ones for the same incident signature.
const configDedupeSuffix = "/config"

// NamespaceDedupeKey separates a config-handled filing's dedupe namespace from
// the code-level one for the same signature.
//
// Without it a config-level issue — filed, never adopted, and therefore left
// OPEN because nobody works it — absorbs every later incident under the same
// key. The create call answers deduped, files nothing and dispatches nothing,
// and the report then carries an issue number, so escalation returns early too.
// A genuine code defect arriving later on that signature would never reach a
// coding agent. Two issues for one signature is the correct outcome there:
// configuration handling a symptom and code owning a defect are two problems.
func NamespaceDedupeKey(dedupeKey, classification string) string {
	if dedupeKey == "" || classification != ClassificationConfigLevel {
		return dedupeKey
	}
	return dedupeKey + configDedupeSuffix
}
