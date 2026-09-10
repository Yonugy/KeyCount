package main

import (
	"fmt"
	"net/http"
	"time"
)

// Global leaderboards -- every registered user, no friendship gating. That
// was a deliberate scope decision for this phase (2026-09-02): the
// personal-facing public_profile flag gates whether visiting someone's
// profile PAGE shows anything (see handlePublicProfile), but it doesn't
// gate leaderboard membership -- a competitive ranking with an opt-out-by-
// default majority of entries missing wouldn't be much of a leaderboard.
// If a future phase wants opt-out-of-ranking too, that's a second,
// separate flag from public_profile, not a repurposing of it.

type leaderboardEntry struct {
	Rank          int    `json:"rank"`
	Username      string `json:"username"`
	Value         int    `json:"value"`
	PublicProfile bool   `json:"public_profile"` // lets the frontend link only entries that actually have a profile page to show
}

const leaderboardLimit = 50

// leaderboardWindowStart maps the leaderboard's own vocabulary
// (daily/weekly/alltime) onto rangeStart's (today/week/all) from
// stats.go, rather than duplicating that boundary logic. Deliberately
// UTC-calendar boundaries, same as rangeStart already uses -- unlike the
// personal dashboard (DayView etc., which the 2026-09 local_date fix made
// timezone-accurate to each viewer's own clock), a GLOBAL ranking has no
// single "local day" to be accurate to: UTC is the one shared clock every
// entrant's numbers get compared against, so there's no equivalent fix
// needed or wanted here.
func leaderboardWindowStart(window string) (time.Time, error) {
	switch window {
	case "", "daily":
		return rangeStart("today")
	case "weekly":
		return rangeStart("week")
	case "alltime":
		return rangeStart("all")
	default:
		return time.Time{}, fmt.Errorf("window must be one of: daily, weekly, alltime")
	}
}

// handleLeaderboardKeystrokes serves
// GET /v1/leaderboards/keystrokes?window=daily|weekly|alltime -- ranked by
// total keystrokes summed from daily_rollups over the window, top 50,
// descending. Users with zero activity in the window are excluded (HAVING
// ... > 0) rather than shown at rank 51+ with a 0 -- a leaderboard with
// every inactive account cluttering the bottom isn't useful to anyone.
func (s *Server) handleLeaderboardKeystrokes(w http.ResponseWriter, r *http.Request) {
	since, err := leaderboardWindowStart(r.URL.Query().Get("window"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.username, u.public_profile, COALESCE(SUM(dr.total_keystrokes), 0) AS total
		 FROM users u
		 JOIN daily_rollups dr ON dr.user_id = u.id AND dr.date >= $1
		 GROUP BY u.id, u.username, u.public_profile
		 HAVING COALESCE(SUM(dr.total_keystrokes), 0) > 0
		 ORDER BY total DESC
		 LIMIT $2`,
		since.Format("2006-01-02"), leaderboardLimit,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load leaderboard")
		return
	}
	defer rows.Close()

	result := []leaderboardEntry{}
	rank := 0
	for rows.Next() {
		rank++
		var e leaderboardEntry
		if err := rows.Scan(&e.Username, &e.PublicProfile, &e.Value); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read leaderboard row")
			return
		}
		e.Rank = rank
		result = append(result, e)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read leaderboard")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleLeaderboardStreak serves GET /v1/leaderboards/streak -- ranked by
// longest_streak (the best a user has ever done, not their current
// streak -- rewarding all-time consistency rather than favoring whoever
// happens to be mid-streak right now), top 50, descending. No `window`
// param: a streak's "window" is inherently its own history, there's no
// daily/weekly cut of it that means anything.
func (s *Server) handleLeaderboardStreak(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.username, u.public_profile, st.longest_streak
		 FROM streaks st JOIN users u ON u.id = st.user_id
		 WHERE st.longest_streak > 0
		 ORDER BY st.longest_streak DESC
		 LIMIT $1`,
		leaderboardLimit,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load leaderboard")
		return
	}
	defer rows.Close()

	result := []leaderboardEntry{}
	rank := 0
	for rows.Next() {
		rank++
		var e leaderboardEntry
		if err := rows.Scan(&e.Username, &e.PublicProfile, &e.Value); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read leaderboard row")
			return
		}
		e.Rank = rank
		result = append(result, e)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read leaderboard")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
