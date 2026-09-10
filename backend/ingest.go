package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type ingestBucket struct {
	BucketStartTS   int64  `json:"bucket_start_ts"`
	AppName         string `json:"app_name"`
	Keystrokes      int    `json:"keystrokes"`
	Backspaces      int    `json:"backspaces"`
	MouseClicks     int    `json:"mouse_clicks"`
	MouseDistancePx int    `json:"mouse_distance_px"`
	// The agent's own local calendar day for this bucket ("2006-01-02"),
	// computed from its machine's local clock. Optional so older agent
	// builds that don't send it still ingest fine -- see the fallback
	// below. Added 2026-08-31/09-01: without it, daily_rollups/streaks
	// were bucketed by UTC calendar day (from BucketStartTS), which is
	// wrong for anyone at a positive UTC offset -- the first |offset|
	// hours of their local day were still "yesterday" in UTC, so activity
	// right after local midnight got filed a day early.
	LocalDate string `json:"local_date,omitempty"`
}

// handleIngestBatch accepts the batches of per-minute buckets the agent's
// local events_buffer table produces. It is idempotent: re-ingesting the
// same (user, bucket_start, device, app) is a no-op, so a retried sync
// after a network blip can't double-count. Only rows actually inserted
// for the first time roll forward into daily_rollups / streaks.
//
// Since 2026-09-02, one real-world minute can arrive as SEVERAL rows here
// -- one per app the agent saw focused while a key was pressed during that
// minute (see agent.py's flush_bucket, and the accuracy-fix note in
// web/README.md) -- rather than always exactly one row per bucket_start
// like before. That's the whole point (an app you typed in for 10s mid-
// minute no longer gets silently dropped), but it means "one row has
// activity" no longer implies "this is a newly-active minute": two app-
// rows for the same bucket_start would otherwise double-count that one
// minute in daily_rollups.active_minutes. The dedup below fixes that
// without touching anything else -- see the activeMinutes map.
func (s *Server) handleIngestBatch(w http.ResponseWriter, r *http.Request) {
	deviceID := r.Context().Value(deviceIDKey).(int64)
	userID := r.Context().Value(deviceUserIDKey).(int64)

	var batch []ingestBucket
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body, expected an array of buckets")
		return
	}
	if len(batch) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"inserted": 0, "received": 0})
		return
	}
	if len(batch) > 500 {
		writeError(w, http.StatusBadRequest, "batch too large, max 500 buckets per request")
		return
	}

	ctx := r.Context()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start transaction")
		return
	}
	defer tx.Rollback() //nolint:errcheck -- no-op once committed

	// Distinct bucket_start instants referenced anywhere in this batch.
	// Built up front (before any inserts) so the "already active" check
	// just below sees only what existed prior to this request, never this
	// batch's own new rows.
	bucketStarts := make(map[int64]time.Time, len(batch))
	for _, b := range batch {
		bucketStarts[b.BucketStartTS] = time.Unix(b.BucketStartTS, 0).UTC()
	}

	// Which of those minutes were ALREADY active (this user+device) before
	// this request, per any prior sync -- e.g. a bucket that already
	// synced an app-row with keystrokes for this minute, and this batch is
	// now delivering a sibling app-row for the same minute (split across
	// two sync passes, or just a later resend after a partial failure).
	// Scoped to this one device only, same as activity_buckets' own
	// uniqueness -- a second device active in the same wall-clock minute
	// is a pre-existing, out-of-scope edge case this fix doesn't touch.
	placeholders := make([]string, 0, len(bucketStarts))
	args := make([]interface{}, 0, len(bucketStarts)+2)
	args = append(args, userID, deviceID)
	i := 3
	for _, t := range bucketStarts {
		args = append(args, t)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}
	alreadyActive := make(map[int64]bool, len(bucketStarts))
	rows, err := tx.QueryContext(ctx,
		`SELECT DISTINCT bucket_start FROM activity_buckets
		 WHERE user_id = $1 AND device_id = $2
		   AND bucket_start IN (`+strings.Join(placeholders, ",")+`)
		   AND (keystrokes > 0 OR clicks > 0)`,
		args...,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check existing active minutes: "+err.Error())
		return
	}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read active-minute check row: "+err.Error())
			return
		}
		alreadyActive[t.Unix()] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(w, http.StatusInternalServerError, "failed to check existing active minutes: "+err.Error())
		return
	}
	rows.Close()

	// Minutes this batch itself has already counted as newly-active, so a
	// second (or third) app-row for the same bucket_start within THIS
	// batch doesn't count again either.
	countedThisBatch := make(map[int64]bool, len(bucketStarts))

	inserted := 0
	for _, b := range batch {
		bucketStart := bucketStarts[b.BucketStartTS]

		res, err := tx.ExecContext(ctx,
			`INSERT INTO activity_buckets
			   (user_id, device_id, bucket_start, app_name, keystrokes, backspaces, clicks, mouse_distance)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (user_id, bucket_start, device_id, app_name) DO NOTHING`,
			userID, deviceID, bucketStart, b.AppName, b.Keystrokes, b.Backspaces, b.MouseClicks, b.MouseDistancePx,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to insert bucket: "+err.Error())
			return
		}
		rowsAffected, err := res.RowsAffected()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check insert result: "+err.Error())
			return
		}
		if rowsAffected == 0 {
			continue // duplicate bucket, already ingested previously
		}
		inserted++

		// Prefer the agent's own local-day field; it's the only side that
		// actually knows the local clock the bucket was captured under.
		// Fall back to the UTC-derived day for older agents that don't
		// send it yet, or if it somehow arrives malformed -- never fail
		// the whole batch over one bad field.
		day := bucketStart.Format("2006-01-02")
		if b.LocalDate != "" {
			if _, err := time.Parse("2006-01-02", b.LocalDate); err == nil {
				day = b.LocalDate
			}
		}

		hasActivity := b.Keystrokes > 0 || b.MouseClicks > 0
		activeMinute := 0
		if hasActivity {
			bsUnix := bucketStart.Unix()
			if !alreadyActive[bsUnix] && !countedThisBatch[bsUnix] {
				activeMinute = 1
				countedThisBatch[bsUnix] = true
			}
		}

		_, err = tx.ExecContext(ctx,
			`INSERT INTO daily_rollups (user_id, date, total_keystrokes, total_clicks, active_minutes)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id, date) DO UPDATE SET
			   total_keystrokes = daily_rollups.total_keystrokes + EXCLUDED.total_keystrokes,
			   total_clicks = daily_rollups.total_clicks + EXCLUDED.total_clicks,
			   active_minutes = daily_rollups.active_minutes + EXCLUDED.active_minutes`,
			userID, day, b.Keystrokes, b.MouseClicks, activeMinute,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update daily rollup: "+err.Error())
			return
		}

		// Decoupled from activeMinute on purpose: updateStreak is already
		// idempotent per CALENDAR DAY (see streaks.go -- it no-ops once
		// last_active_date already equals `day`), so it doesn't need the
		// per-minute dedup active_minutes does. Gating it on hasActivity
		// directly also means the day still gets marked active even if,
		// by bucket ordering within a batch, the row that happens to
		// carry activeMinute==1 for a given minute isn't the first one
		// processed for that day.
		if hasActivity {
			if err := updateStreak(ctx, tx, userID, day); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update streak: "+err.Error())
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not commit transaction")
		return
	}

	writeJSON(w, http.StatusOK, map[string]int{"inserted": inserted, "received": len(batch)})
}
