package main

import "net/http"

type dayAppStat struct {
	AppName    string `json:"app_name"`
	Keystrokes int    `json:"keystrokes"`
	Clicks     int    `json:"clicks"`
}

// handleMeDayApps serves GET /v1/me/day-apps?since=<unix>&until=<unix> --
// per-app keystroke/click totals for the same one-local-calendar-day
// window handleMeDayBuckets uses (identical since/until contract -- see
// that handler's comment in day_buckets.go for the full "why the server
// does no timezone math" explanation; parseDayWindow is shared by both).
//
// This is the actual payoff of the 2026-09-02 accuracy fix: DayView can
// now show "which app did I type in the most on this day" with sub-
// minute accuracy, because agent.py's flush_bucket() started tagging
// each minute's keystrokes with the app that ACTUALLY had focus at the
// moment each key was pressed (sampled per-keypress, same as the local
// Keys tab has done since 2026-08-31) instead of one once-a-minute
// snapshot that silently dropped anything typed in a briefly-focused
// app. Only keystrokes/backspaces got that treatment -- clicks/mouse
// distance still use the coarser once-a-minute foreground sample, a
// deliberate scope decision (keystroke accuracy was the priority; clicks
// staying coarse was explicitly fine) -- so the Clicks field here still
// carries the older, coarser per-app attribution. That's a known,
// intentional asymmetry, not a bug: don't "fix" it by trying to
// interpolate click attribution from something it was never sampled
// against.
//
// Same GROUP BY collapse as apps_breakdown.go's handleAppsBreakdown, just
// scoped to one exact day (since/until) instead of a rangeStart()
// window -- rangeStart's "today" is UTC-midnight-relative, which is
// wrong for a per-local-day breakdown for the same reason the
// local_date fix exists at all (see day_buckets.go's comment), so this
// endpoint intentionally does NOT reuse rangeStart/handleAppsBreakdown.
func (s *Server) handleMeDayApps(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	since, until, errMsg := parseDayWindow(r)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT app_name, COALESCE(SUM(keystrokes), 0), COALESCE(SUM(clicks), 0)
		 FROM activity_buckets
		 WHERE user_id = $1 AND bucket_start >= $2 AND bucket_start < $3
		 GROUP BY app_name ORDER BY SUM(keystrokes) DESC`,
		userID, since, until,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load day apps breakdown")
		return
	}
	defer rows.Close()

	result := []dayAppStat{}
	for rows.Next() {
		var a dayAppStat
		if err := rows.Scan(&a.AppName, &a.Keystrokes, &a.Clicks); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read day apps row")
			return
		}
		result = append(result, a)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read day apps breakdown")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
