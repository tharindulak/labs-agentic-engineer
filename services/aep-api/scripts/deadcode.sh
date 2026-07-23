#!/usr/bin/env bash
#
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#
# Dead-code gate for aep-api.
#
# Runs golang.org/x/tools/cmd/deadcode — a whole-program Rapid Type Analysis
# that builds the call graph reachable from the cmd/aep-api main and reports
# every function/method NOTHING live reaches. It is run WITHOUT -test on
# purpose: tests do NOT count as consumers, so a function only a test calls is
# dead (delete it and its orphaned test). generated files (`// Code generated
# … DO NOT EDIT.`) are excluded by deadcode itself.
#
# Two categories are filtered out of the result — they are unreachable BY
# DESIGN, not dead:
#
#   1. Test-support packages ($EXCLUDE_RE): mocks, and the dbtest/gittest/
#      componenttest/… harnesses the suite runs on. They exist only to be
#      consumed by tests. Identified by dir name or the *_fortest.go suffix.
#   2. Functions carrying a `//deadcode:keep <reason>` marker in their doc
#      comment: intentional test seams that let tests drive live code, and
#      infrastructure retained but not yet wired (e.g. the OpenBao backend).
#
# Usage:
#   scripts/deadcode.sh report   # human audit — prints findings, always exit 0
#   scripts/deadcode.sh check    # CI gate    — exit 1 if any finding survives
set -euo pipefail

cd "$(dirname "$0")/.."

DEADCODE_VERSION="v0.44.0"
DEADCODE="go run golang.org/x/tools/cmd/deadcode@${DEADCODE_VERSION}"

# Test-support packages/files — unreachable by design, never deletion targets.
EXCLUDE_RE='/mocks/|/artifactstest/|/componenttest/|/dbtest/|/gittest/|/contracttest/|/workspacetest/|_fortest\.go'

mode="${1:-check}"

# has_marker FILE LINE — true if the func at LINE carries a //deadcode:keep
# marker on its own line or anywhere in the contiguous comment block directly
# above it (the Go doc comment). Stops at the first non-comment line so a
# marker on a PRECEDING function never leaks onto this one.
has_marker() {
	awk -v t="$2" '
		{ L[NR] = $0 }
		END {
			if (index(L[t], "deadcode:keep")) { print "y"; exit }
			for (i = t - 1; i >= 1; i--) {
				c = L[i]; sub(/^[ \t]+/, "", c)
				if (c ~ /^\/\//) {
					if (index(c, "deadcode:keep")) { print "y"; exit }
					continue
				}
				break
			}
		}' "$1"
}

raw="$($DEADCODE ./... 2>/dev/null || true)"

survivors=""
while IFS= read -r line; do
	[ -z "$line" ] && continue
	case "$line" in *"unreachable func"*) ;; *) continue ;; esac
	path="${line%%:*}"
	printf '%s\n' "$path" | grep -qE "$EXCLUDE_RE" && continue
	lno="$(printf '%s\n' "$line" | cut -d: -f2)"
	[ -n "$(has_marker "$path" "$lno")" ] && continue
	survivors+="${line}"$'\n'
done <<< "$raw"

survivors="$(printf '%s' "$survivors" | sed '/^$/d')"

if [ "$mode" = "report" ]; then
	if [ -z "$survivors" ]; then
		echo "deadcode: no dead functions (excluding test-support + //deadcode:keep)."
	else
		count="$(printf '%s\n' "$survivors" | wc -l | tr -d ' ')"
		echo "deadcode: ${count} unreachable function(s) from cmd/aep-api (tests do not count):"
		echo ""
		printf '%s\n' "$survivors" | sed 's/^/  /'
	fi
	exit 0
fi

# check mode (gate)
if [ -n "$survivors" ]; then
	count="$(printf '%s\n' "$survivors" | wc -l | tr -d ' ')"
	echo "FAIL: ${count} dead function(s) unreachable from cmd/aep-api (tests do not count):"
	echo ""
	printf '%s\n' "$survivors" | sed 's/^/  /'
	echo ""
	echo "Each must be resolved:"
	echo "  - delete it (and its orphaned test), OR"
	echo "  - if it is a test seam / intentionally-retained infra, add a"
	echo "    '//deadcode:keep <reason>' line to its doc comment, OR"
	echo "  - if it belongs in a test-support package, move it there."
	echo "See the dead-code note in services/AGENTS.md."
	exit 1
fi

echo "deadcode: OK — no dead functions."
