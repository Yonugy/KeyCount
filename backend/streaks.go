package main

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

// clientToday is the caller's local calendar day, sent by the web app as
// ?today=YYYY-MM-DD (the server stays timezone-naive, same as the
// local_date ingest fix). Missing, malformed or more than a day away from
// the server's UTC date falls back to the UTC date.
func clientToday(r *http.Request) string {
	utc := time.Now().UTC()
	fallback := utc.Format("2006-01-02")
	t, err := time.Parse("2006-01-02", r.URL.Query().Get("today"))
	if err != nil {
		return fallback
	}
	utcDay := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
	if diff := t.Sub(utcDay); diff < -24*time.Hour || diff > 24*time.Hour {
		return fallback
	}
	return t.Format("2006-01-02")
}

// effectiveCurrentStreak turns the stored streak into the one to show.
// The stored value only changes when new activity arrives, so on its own
// a streak that ended days ago would keep showing until the user came
// back. It stays alive while the last active day is today or yesterday,
// and shows 0 once a whole day was missed.
func effectiveCurrentStreak(stored int, lastActive *string, today string) int {
	if lastActive == nil {
		return 0
	}
	last, err1 := time.Parse("2006-01-02", *lastActive)
	cur, err2 := time.Parse("2006-01-02", today)
	if err1 != nil || err2 != nil {
		return stored
	}
	if cur.Sub(last) > 24*time.Hour {
		return 0
	}
	return stored
}

// updateStreak keeps streaks.current_streak / longest_streak / last_active_date
// in sync as new active days show up in the ingest stream. It's a simple
// "yesterday -> extend, otherwise reset to 1" rule, matching the streak
// gamification described in the system design doc.
func updateStreak(ctx context.Context, tx *sql.Tx, userID int64, day string) error {
	var currentStreak, longestStreak int
	var lastActiveDate *string

	err := tx.QueryRowContext(ctx,
		`SELECT current_streak, longest_streak, last_active_date::text FROM streaks WHERE user_id = $1`,
		userID,
	).Scan(&currentStreak, &longestStreak, &lastActiveDate)

	if err == sql.ErrNoRows {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
			 VALUES ($1, 1, 1, $2)`,
			userID, day,
		)
		return err
	}
	if err != nil {
		return err
	}

	if lastActiveDate != nil && *lastActiveDate == day {
		return nil // already counted today, nothing to do
	}

	newStreak := 1
	if lastActiveDate != nil && isNextDay(*lastActiveDate, day) {
		newStreak = currentStreak + 1
	}
	if newStreak > longestStreak {
		longestStreak = newStreak
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE streaks SET current_streak = $1, longest_streak = $2, last_active_date = $3 WHERE user_id = $4`,
		newStreak, longestStreak, day, userID,
	)
	return err
}

func isNextDay(lastDate, today string) bool {
	last, err1 := time.Parse("2006-01-02", lastDate)
	cur, err2 := time.Parse("2006-01-02", today)
	if err1 != nil || err2 != nil {
		return false
	}
	return cur.Sub(last) == 24*time.Hour
}
