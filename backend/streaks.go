package main

import (
	"context"
	"database/sql"
	"time"
)

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
