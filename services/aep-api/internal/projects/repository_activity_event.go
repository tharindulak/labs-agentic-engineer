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

package projects

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ActivityEventRepository is the append-only store behind the project activity
// feed (issue #239). Writes are deduped on (org_id, project_id, dedup_key);
// reads are newest-first with a keyset (occurred_at, id) cursor.
type ActivityEventRepository struct{ db *gorm.DB }

// NewActivityEventRepository returns a repository backed by db.
func NewActivityEventRepository(db *gorm.DB) *ActivityEventRepository {
	return &ActivityEventRepository{db: db}
}

// Insert appends the row, treating a duplicate dedup key as a no-op. inserted
// reflects whether a new row landed (RowsAffected), so a retried/redelivered
// event does not trigger a redundant live-tail notify.
func (r *ActivityEventRepository) Insert(ctx context.Context, row *ActivityEvent) (bool, error) {
	res := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "project_id"}, {Name: "dedup_key"}},
		DoNothing: true,
	}).Create(row)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// ListByProject returns a project's events newest-first, at most limit. A
// non-zero beforeTime pages to rows strictly older than (beforeTime, beforeID)
// — a keyset cursor stable under concurrent inserts.
func (r *ActivityEventRepository) ListByProject(ctx context.Context, orgID, projectID string, limit int, beforeTime time.Time, beforeID string) ([]ActivityEvent, error) {
	q := r.db.WithContext(ctx).
		Where("org_id = ? AND project_id = ?", orgID, projectID).
		Order("occurred_at DESC, id DESC").
		Limit(limit)
	if !beforeTime.IsZero() {
		q = q.Where("(occurred_at, id) < (?, ?)", beforeTime, beforeID)
	}
	var rows []ActivityEvent
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}
