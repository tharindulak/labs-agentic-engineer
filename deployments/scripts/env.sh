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

# Shared cluster environment variables — sourced by all scripts in this directory.
# OPENCHOREO_VERSION bumped 1.0.1-hotfix.1 -> 1.1.1: the Resource model
# (ResourceType/Resource/ResourceReleaseBinding/ClusterResourceType) that the
# postgres-cnpg platform-resource sample depends on first ships in OC v1.1.0
# (stable v1.1.1) and is absent from the prior pin.
OPENCHOREO_VERSION="1.1.1"
THUNDER_VERSION="0.34.0"
CNPG_VERSION="0.29.0"
CLUSTER_NAME="openchoreo"
CLUSTER_CONTEXT="k3d-${CLUSTER_NAME}"

# Where the data-plane gateway's CA certificate is exported for clients on the
# host. Deployed endpoints are advertised over https (`register_data_plane`), and
# the serving cert is issued by an in-cluster CA that nothing on the host has any
# reason to trust — so `curl --cacert "$GATEWAY_CA_FILE" <endpoint>` is the
# verifying call, and this path is what the developer guide points at. Gitignored
# and rewritten on every setup run: a cluster rebuild mints a new CA, and a stale
# file fails verification indistinguishably from an untrusted one.
GATEWAY_CA_FILE="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}/../.local/openchoreoapis-ca.crt"
