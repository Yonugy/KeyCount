package main

import (
	"net/http"
	"strconv"
	"time"
)

type dayStat struct {
	Date            string `json:"date"`
	TotalKeystrokes int    `json:"total_keystrokes"`
	TotalClicks     int    `json:"total_clicks"`
	ActiveMinutes   int    `json:"active_minutes"`
}

// handleMeHistory serves GET /v1/me/history?days=N -- one row per day for
// the last N days (default 30, max 366), straight from daily_rollups. This
// is what powers the dashboard's activity heatmap and the "over time"
// chart; days with no activity simply don't have a row (the frontend fills
// the gaps with zeros).
func (s *Server) handleMeHistory(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		parsed, err := strconv.Atoi(d)
		if err != nil || parsed <= 0 || parsed > 366 {
			writeError(w, http.StatusBadRequest, "days must be a positive integer up to 366")
			return
		}
		days = parsed
	}

	since := time.Now().UTC().AddDate(0, 0, -days+1)
	since = time.Date(since.Year(), since.Month(), since.Day(), 0, 0, 0, 0, time.UTC)

	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT date, total_keystrokes, total_clicks, active_minutes
		 FROM daily_rollups WHERE user_id = $1 AND date >= $2 ORDER BY date`,
		userID, since.Format("2006-01-02"),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	defer rows.Close()

	result := []dayStat{}
	for rows.Next() {
		var d dayStat
		var date time.Time
		if err := rows.Scan(&date, &d.TotalKeystrokes, &d.TotalClicks, &d.ActiveMinutes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read history row")
			return
		}
		d.Date = date.Format("2006-01-02")
		result = append(result, d)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read history")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
