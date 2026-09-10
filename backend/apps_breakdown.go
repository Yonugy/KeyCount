package main

import "net/http"

type appStat struct {
	AppName    string `json:"app_name"`
	Keystrokes int    `json:"keystrokes"`
	Clicks     int    `json:"clicks"`
}

// handleAppsBreakdown serves GET /v1/me/apps-breakdown?range=today|week|month|all
// -- per-app totals for the range, straight from activity_buckets (not
// pre-rolled-up like daily_rollups, since this is a much smaller scan and
// there's no per-app rollup table yet).
func (s *Server) handleAppsBreakdown(w http.ResponseWriter, r *http.Request) {
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

	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT app_name, COALESCE(SUM(keystrokes), 0), COALESCE(SUM(clicks), 0)
		 FROM activity_buckets WHERE user_id = $1 AND bucket_start >= $2
		 GROUP BY app_name ORDER BY SUM(keystrokes) DESC`,
		userID, since,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load apps breakdown")
		return
	}
	defer rows.Close()

	result := []appStat{}
	for rows.Next() {
		var a appStat
		if err := rows.Scan(&a.AppName, &a.Keystrokes, &a.Clicks); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read apps breakdown row")
			return
		}
		result = append(result, a)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read apps breakdown")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
