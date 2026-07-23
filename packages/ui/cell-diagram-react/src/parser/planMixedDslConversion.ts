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

import { isCellDslStatement } from "./parseCellDsl";
import { parseCrossEdge } from "./crossEdge";
import { parseCellHeader, splitCells } from "./splitCells";

export interface MixedDslConversion {
  source: string;
  cellId: string;
  movedLineCount: number;
}

function nextCellId(existingIds: Set<string>): string {
  if (!existingIds.has("main")) {
    return "main";
  }

  let suffix = 2;
  while (existingIds.has(`main-${suffix}`)) {
    suffix += 1;
  }
  return `main-${suffix}`;
}

function isComment(statement: string): boolean {
  return statement.startsWith("#") || statement.startsWith("//");
}

export function planMixedDslConversion(source: string): MixedDslConversion | null {
  const split = splitCells(source);
  if (split.implicit || split.diagnostics.length > 0 || split.cells.length === 0) {
    return null;
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(newline);
  const movedIndices = new Set<number>();
  let pendingTrivia: number[] = [];
  let insideCell = false;
  let insertionIndex = -1;
  let movedLineCount = 0;

  lines.forEach((rawLine, index) => {
    const statement = rawLine.trim();

    if (!insideCell) {
      const header = parseCellHeader(statement);
      if (header) {
        if (insertionIndex === -1) {
          insertionIndex = pendingTrivia[0] ?? index;
        }
        pendingTrivia = [];
        insideCell = true;
        return;
      }
    }

    if (insideCell) {
      if (statement === "}") {
        insideCell = false;
      }
      return;
    }

    if (!statement || isComment(statement)) {
      pendingTrivia.push(index);
      return;
    }

    if (statement.startsWith("title ")) {
      pendingTrivia = [];
      return;
    }

    const crossEdge = parseCrossEdge(statement, index + 1);
    const isConvertibleCrossEdge = crossEdge !== null && !("error" in crossEdge) && crossEdge.sourceCell === null;
    const isConvertibleCellStatement = crossEdge === null && isCellDslStatement(statement);
    const isConvertible = isConvertibleCrossEdge || isConvertibleCellStatement;

    if (isConvertible) {
      pendingTrivia.forEach((triviaIndex) => movedIndices.add(triviaIndex));
      pendingTrivia = [];
      movedIndices.add(index);
      movedLineCount += 1;
      return;
    }

    pendingTrivia = [];
  });

  if (insertionIndex === -1 || movedLineCount === 0) {
    return null;
  }

  const cellId = nextCellId(new Set(split.cells.map((cell) => cell.id)));
  const movedLines = lines
    .filter((_, index) => movedIndices.has(index))
    .map((line) => (line.trim().length === 0 ? "" : `  ${line.trimStart()}`));
  const separator = lines[insertionIndex].trim().length === 0 ? [] : [""];
  const generatedBlock = [`cell ${cellId} {`, ...movedLines, "}", ...separator];
  const convertedLines: string[] = [];

  lines.forEach((line, index) => {
    if (index === insertionIndex) {
      convertedLines.push(...generatedBlock);
    }
    if (!movedIndices.has(index)) {
      convertedLines.push(line);
    }
  });

  return {
    source: convertedLines.join(newline),
    cellId,
    movedLineCount
  };
}
