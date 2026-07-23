/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import type { Edge, Node } from "@xyflow/react";

export interface DiagramMotionSnapshot {
  contextKey: string;
  nodeIds: Set<string>;
  nodeIdsByMotionKey: Map<string, string>;
  edgeKeys: Set<string>;
}

export interface DiagramMotionClassification {
  enteringNodeIds: Set<string>;
  movingNodeIds: Set<string>;
  enteringEdgeIds: Set<string>;
  snapshot: DiagramMotionSnapshot;
}

function edgeMotionEntries(edges: Edge[]) {
  const occurrences = new Map<string, number>();

  return edges.map((edge) => {
    const signature = [edge.source, edge.sourceHandle, edge.target, edge.targetHandle, edge.type].join("|");
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);

    return { id: edge.id, key: `${signature}|${occurrence}` };
  });
}

function nodeMotionKey(node: Node) {
  const motionKey = node.data?.motionKey;
  return typeof motionKey === "string" && motionKey ? motionKey : `id:${node.id}`;
}

export function classifyDiagramMotion(
  previous: DiagramMotionSnapshot | null,
  nodes: Node[],
  edges: Edge[],
  contextKey: string
): DiagramMotionClassification {
  const edgeEntries = edgeMotionEntries(edges);
  const snapshot: DiagramMotionSnapshot = {
    contextKey,
    nodeIds: new Set(nodes.map((node) => node.id)),
    nodeIdsByMotionKey: new Map(nodes.map((node) => [nodeMotionKey(node), node.id])),
    edgeKeys: new Set(edgeEntries.map((edge) => edge.key))
  };

  if (!previous || previous.contextKey !== contextKey) {
    return {
      enteringNodeIds: new Set(),
      movingNodeIds: new Set(),
      enteringEdgeIds: new Set(),
      snapshot
    };
  }

  const currentNodeIds = snapshot.nodeIds;
  const isExistingNode = (node: Node) => {
    if (previous.nodeIds.has(node.id)) {
      return true;
    }

    const previousIdOnSameSourceLine = previous.nodeIdsByMotionKey.get(nodeMotionKey(node));
    return Boolean(previousIdOnSameSourceLine && !currentNodeIds.has(previousIdOnSameSourceLine));
  };
  const hasRenamedNode = nodes.some((node) => !previous.nodeIds.has(node.id) && isExistingNode(node));
  const isConnectedRename = hasRenamedNode && edgeEntries.length === previous.edgeKeys.size;

  return {
    enteringNodeIds: new Set(
      nodes
        .filter((node) => node.type !== "cellBoundary" && !isExistingNode(node))
        .map((node) => node.id)
    ),
    movingNodeIds: new Set(nodes.filter(isExistingNode).map((node) => node.id)),
    enteringEdgeIds: new Set(
      isConnectedRename
        ? []
        : edgeEntries.filter((edge) => !previous.edgeKeys.has(edge.key)).map((edge) => edge.id)
    ),
    snapshot
  };
}
