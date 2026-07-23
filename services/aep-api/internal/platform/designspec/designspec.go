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

// Package designspec validates a component design.json against the ONE
// published JSON Schema definition (docs/design/agents-generation-migration.md
// §8): packages/contracts/schemas/component-design.schema.json, mirrored here as
// a vendored embed because go:embed cannot cross the aep-api Go module boundary.
// The agent's FileBundle write-gate (services/agents) and this Go validator both
// key off that single file, so BFF and agent never drift into two hand-kept
// copies.
//
// The validation error codes mirror the agent's checkComponentDesign:
// INVALID_JSON (unparseable) and SCHEMA_VIOLATION (fails the schema, or the
// name != component-directory rule the schema itself cannot express).
package designspec

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed component-design.schema.json
var schemaJSON []byte

// Error codes (mirroring the agent's write gate).
const (
	CodeInvalidJSON     = "INVALID_JSON"
	CodeSchemaViolation = "SCHEMA_VIOLATION"
)

// ValidationError carries a stable code + human message for a rejected
// component design.json.
type ValidationError struct {
	Code    string
	Message string
}

func (e *ValidationError) Error() string { return e.Code + ": " + e.Message }

// componentSchema is the parsed embedded schema, loaded once at init. The schema
// is small and fixed, so a package-level parse is fine.
var componentSchema = mustParseSchema(schemaJSON)

// ValidateComponentDesign checks raw component design.json bytes against the
// embedded schema. Returns nil when valid, or a *ValidationError.
func ValidateComponentDesign(raw []byte) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return &ValidationError{Code: CodeInvalidJSON, Message: "content is not valid JSON: " + err.Error()}
	}
	if msgs := validate(v, componentSchema, ""); len(msgs) > 0 {
		return &ValidationError{Code: CodeSchemaViolation, Message: msgs[0]}
	}
	return nil
}

// ValidateComponentDesignInDir additionally enforces the rule the schema cannot
// express: the design.json `name` must equal the component directory name
// (mirrors the agent's checkComponentDesign). dirName is the <name> segment of
// specs/design/components/<name>/design.json.
func ValidateComponentDesignInDir(raw []byte, dirName string) error {
	if err := ValidateComponentDesign(raw); err != nil {
		return err
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return &ValidationError{Code: CodeInvalidJSON, Message: err.Error()}
	}
	name, _ := obj["name"].(string)
	if name != dirName {
		return &ValidationError{
			Code:    CodeSchemaViolation,
			Message: fmt.Sprintf("name %q must equal the component directory name %q", name, dirName),
		}
	}
	return nil
}

// ---- a compact JSON Schema interpreter -------------------------------------
//
// It supports exactly the draft-2020-12 keywords the component-design schema
// uses: type, properties, required, additionalProperties (either the boolean
// `false` — strict, reject unknown keys — or a subschema, e.g. the unified
// dependency's `parameters` map whose additionalProperties is `{type:"string"}`,
// treated as permissive), enum, minLength, minItems, items. Driving validation
// from the embedded file (rather than a hand-coded Go mirror) is what keeps
// the "one definition" invariant (§8).

type schema struct {
	Type       string             `json:"type"`
	Properties map[string]*schema `json:"properties"`
	Required   []string           `json:"required"`
	// AdditionalProperties is either a boolean or a subschema object (draft
	// 2020-12), so it is decoded raw: only the literal `false` triggers the
	// strict "no unknown properties" check; `true` or any subschema (used by the
	// dependency `parameters` string-map) is permissive.
	AdditionalProperties json.RawMessage `json:"additionalProperties"`
	Enum                 []any           `json:"enum"`
	MinLength            *int            `json:"minLength"`
	// MinItems enforces an array's minimum length (e.g. a dependency's
	// `candidates` — 2+ — per the derived-state resolution model: a field
	// that is ever written must carry meaningful content, never an empty
	// placeholder).
	MinItems *int    `json:"minItems"`
	Items    *schema `json:"items"`
}

func mustParseSchema(raw []byte) *schema {
	var s schema
	if err := json.Unmarshal(raw, &s); err != nil {
		panic("designspec: cannot parse embedded schema: " + err.Error())
	}
	return &s
}

// validate returns the schema-violation messages for value at path (empty on
// success). It stops collecting once it has at least one message per node so the
// caller reports the first, most-specific failure.
func validate(value any, s *schema, path string) []string {
	if s == nil {
		return nil
	}
	switch s.Type {
	case "object":
		return validateObject(value, s, path)
	case "array":
		return validateArray(value, s, path)
	case "string":
		return validateString(value, s, path)
	case "boolean":
		if _, ok := value.(bool); !ok {
			return []string{at(path) + "must be a boolean"}
		}
	case "number", "integer":
		if _, ok := value.(float64); !ok {
			return []string{at(path) + "must be a number"}
		}
	}
	return nil
}

func validateObject(value any, s *schema, path string) []string {
	obj, ok := value.(map[string]any)
	if !ok {
		return []string{at(path) + "must be an object"}
	}
	for _, req := range s.Required {
		if _, present := obj[req]; !present {
			return []string{at(path) + "missing required property " + req}
		}
	}
	if string(s.AdditionalProperties) == "false" {
		for k := range obj {
			if _, declared := s.Properties[k]; !declared {
				return []string{at(path) + "unknown property " + k}
			}
		}
	}
	for name, sub := range s.Properties {
		if v, present := obj[name]; present {
			if msgs := validate(v, sub, join(path, name)); len(msgs) > 0 {
				return msgs
			}
		}
	}
	return nil
}

func validateArray(value any, s *schema, path string) []string {
	arr, ok := value.([]any)
	if !ok {
		return []string{at(path) + "must be an array"}
	}
	if s.MinItems != nil && len(arr) < *s.MinItems {
		return []string{at(path) + fmt.Sprintf("must have at least %d items", *s.MinItems)}
	}
	for i, item := range arr {
		if msgs := validate(item, s.Items, fmt.Sprintf("%s[%d]", path, i)); len(msgs) > 0 {
			return msgs
		}
	}
	return nil
}

func validateString(value any, s *schema, path string) []string {
	str, ok := value.(string)
	if !ok {
		return []string{at(path) + "must be a string"}
	}
	if s.MinLength != nil && len(str) < *s.MinLength {
		return []string{at(path) + fmt.Sprintf("must be at least %d characters", *s.MinLength)}
	}
	if len(s.Enum) > 0 && !enumContains(s.Enum, str) {
		return []string{at(path) + fmt.Sprintf("%q is not an allowed value", str)}
	}
	return nil
}

func enumContains(enum []any, v string) bool {
	for _, e := range enum {
		if es, ok := e.(string); ok && es == v {
			return true
		}
	}
	return false
}

func join(path, name string) string {
	if path == "" {
		return name
	}
	return path + "." + name
}

func at(path string) string {
	if path == "" {
		return ""
	}
	return path + ": "
}
