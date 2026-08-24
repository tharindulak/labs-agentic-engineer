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

package migrate

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// RunPhase14RcaReportRecurrence adds rca_agent_reports.recurrence — which
// attempt an incident is on, so the console's alert detail can say "attempt 3"
// rather than showing a reopened incident as if it were a fresh one (ADR-0021).
//
// It needs its own phase because phase10 CREATEs the table behind a hasTable
// guard: on any database that already has rca_agent_reports, phase10 is a no-op
// and a column added to its CREATE statement would never reach an existing
// deployment. New columns on an existing table are always their own additive
// step here — the table's model is NOT in BaseModels, so nothing AutoMigrates it
// either.
//
// DEFAULT 0 rather than 1, and 0 means "unknown": rows written before this
// column existed, and reports from an SRE agent too old to send the field, have
// no attempt number. Backfilling them to 1 would assert something no evidence
// supports — that each was a first attempt — and the console reads anything
// below 2 as "say nothing", which is the honest rendering of unknown.
//
// Idempotent — ADD COLUMN IF NOT EXISTS, guarded on the table existing at all so
// a fresh database that has not reached phase10 yet does not fail here.
func RunPhase14RcaReportRecurrence(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).Exec(`
		DO $$ BEGIN
		  IF EXISTS (SELECT FROM information_schema.tables
		             WHERE table_schema='public' AND table_name='rca_agent_reports') THEN
		    ALTER TABLE rca_agent_reports
		      ADD COLUMN IF NOT EXISTS recurrence INTEGER NOT NULL DEFAULT 0;
		  END IF;
		END $$
	`).Error; err != nil {
		return fmt.Errorf("phase14_rca_report_recurrence: add recurrence: %w", err)
	}
	return nil
}
