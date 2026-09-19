package main

import (
	"fmt"
	"net/http"
	"time"
)

// rangeStart turns a ?range= query value into the earliest instant that
// range covers. Shared by /v1/me/stats and /v1/me/apps-breakdown so both
// endpoints agree on what "today"/"week"/"month"/"all" mean.
//
// Fixed 2026-09-17: this used to subtract from the current instant
// (now.AddDate(0, 0, -7)) and then get truncated to a bare date by the
// caller's since.Format("2006-01-02") before being used in `date >= $2`.
// Truncating a timestamp to a date always rounds down, so "7 days before
// this instant" lands on the SAME calendar date as "7 days before
// midnight" -- meaning the inclusive `>= that date` range actually spans
// 8 calendar dates (that date through today), not 7. That's what produced
// the "Last 7 days" chart sitting above an "Averaged over 8 days" caption
// (both real, just built from two different day-counts of the same
// window). Fixed by truncating to the start of today FIRST, then
// subtracting whole days: "week" is today minus 6 days, so the inclusive
// range is exactly 7 calendar dates, matching WeekChart's 7 bars
// (TodayView.tsx's last7Days, which is a fixed 7-entry slice and was
// never affected by this). "month" gets the same start-of-day truncation
// for the same reason, though its day-count still varies 28-31 days by
// design (see TodayView.tsx's note on why a 30-day chart is "close
// enough" against the calendar-month total) -- only the extra off-by-one
// from time-of-day truncation is what's fixed here.
func rangeStart(rangeParam string) (time.Time, error) {
	now := time.Now().UTC()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	switch rangeParam {
	case "today":
		return startOfToday, nil
	case "week":
		return startOfToday.AddDate(0, 0, -6), nil
	case "month":
		return startOfToday.AddDate(0, -1, 0), nil
	case "all":
		return time.Unix(0, 0).UTC(), nil
	default:
		return time.Time{}, fmt.Errorf("range must be one of: today, week, month, all")
	}
}

type statsResponse struct {
	Range           string `json:"range"`
	TotalKeystrokes int    `json:"total_keystrokes"`
	TotalClicks     int    `json:"total_clicks"`
	ActiveMinutes   int    `json:"active_minutes"`
	CurrentStreak   int    `json:"current_streak"`
	LongestStreak   int    `json:"longest_streak"`

	// Added 2026-09-07 for the Week/Month/All-time tabs' "daily average"
	// row (frontend request: "be sure to only calculate for those days
	// that has usage" -- e.g. 3 active days in a 30-day month range
	// should average over 3, not 30). ActiveDays is the denominator
	// that produced Avg* below, exposed so the frontend can show it
	// next to the average ("averaged over N days") rather than the
	// average looking like a flat daily rate. A day counts as active if
	// it has ANY recorded activity (keystrokes, clicks, or active
	// minutes) -- one shared definition for all three averages, not a
	// separate denominator per metric.
	ActiveDays       int     `json:"active_days"`
	AvgKeystrokes    float64 `json:"avg_keystrokes"`
	AvgClicks        float64 `json:"avg_clicks"`
	AvgActiveMinutes float64 `json:"avg_active_minutes"`
}

// handleMeStats serves GET /v1/me/stats?range=today|week|month|all for the
// authenticated user, summed from daily_rollups (never recomputed from raw
// activity_buckets on every request -- see design doc section 4.1).
func (s *Server) handleMeStats(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	rangeParam := r.URL.Query().Get("range")
	if rangeParam == "" {
		rangeParam = "today"
	}

	since, err := rangeStart(rangeParam)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := statsResponse{Range: rangeParam}

	err = s.DB.QueryRowContext(r.Context(),
		`SELECT COALESCE(SUM(total_keystrokes), 0), COALESCE(SUM(total_clicks), 0), COALESCE(SUM(active_minutes), 0),
		        COUNT(*) FILTER (WHERE total_keystrokes > 0 OR total_clicks > 0 OR active_minutes > 0)
		 FROM daily_rollups WHERE user_id = $1 AND date >= $2`,
		userID, since.Format("2006-01-02"),
	).Scan(&resp.TotalKeystrokes, &resp.TotalClicks, &resp.ActiveMinutes, &resp.ActiveDays)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load stats")
		return
	}

	// Guarded against ActiveDays == 0 (no activity anywhere in the range)
	// so this stays 0 instead of a NaN/Inf from a 0/0 divide.
	if resp.ActiveDays > 0 {
		resp.AvgKeystrokes = float64(resp.TotalKeystrokes) / float64(resp.ActiveDays)
		resp.AvgClicks = float64(resp.TotalClicks) / float64(resp.ActiveDays)
		resp.AvgActiveMinutes = float64(resp.ActiveMinutes) / float64(resp.ActiveDays)
	}

	// No row yet (user has never had an active day) just leaves these at
	// zero -- that's fine, so the error here is intentionally ignored.
	_ = s.DB.QueryRowContext(r.Context(),
		`SELECT current_streak, longest_streak FROM streaks WHERE user_id = $1`,
		userID,
	).Scan(&resp.CurrentStreak, &resp.LongestStreak)

	writeJSON(w, http.StatusOK, resp)
}
