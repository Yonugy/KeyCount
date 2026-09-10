package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

type settingsResponse struct {
	Username      string `json:"username"`
	PublicProfile bool   `json:"public_profile"`
	// MemberSince ("2006-01-02", same format as publicProfileResponse's
	// own field below) was added for the authenticated "Profile" tab --
	// that tab shows you your own username/member-since/stats regardless
	// of whether public_profile is on, so it can't be sourced from
	// handlePublicProfile (which 404s while private -- that's the whole
	// point of the flag). Settings was the natural place to add it since
	// it's already the one endpoint returning your own account-identity
	// fields, not a new one-off endpoint just for this.
	MemberSince string `json:"member_since"`
}

// handleGetSettings serves GET /v1/me/settings. Originally just the one
// opt-in flag; a natural home for future account settings (excluded-apps
// sync between agent and dashboard, notification prefs, etc. -- see the
// design doc's "polish" milestone) rather than inventing a new endpoint
// each time one shows up -- member_since (see its own comment) is the
// first thing to actually land there.
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)
	var resp settingsResponse
	var createdAt time.Time
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT username, public_profile, created_at FROM users WHERE id = $1`, userID,
	).Scan(&resp.Username, &resp.PublicProfile, &createdAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	resp.MemberSince = createdAt.Format("2006-01-02")
	writeJSON(w, http.StatusOK, resp)
}

type patchSettingsRequest struct {
	PublicProfile *bool `json:"public_profile"`
}

// handlePatchSettings serves PATCH /v1/me/settings. PublicProfile is a
// pointer so an omitted field is distinguishable from an explicit
// `false` -- matters once a second settable field exists and a client
// wants to change just one of them without having to resend both.
func (s *Server) handlePatchSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	var req patchSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.PublicProfile == nil {
		writeError(w, http.StatusBadRequest, "public_profile is required")
		return
	}

	if _, err := s.DB.ExecContext(r.Context(),
		`UPDATE users SET public_profile = $1 WHERE id = $2`, *req.PublicProfile, userID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "could not update settings")
		return
	}

	var resp settingsResponse
	var createdAt time.Time
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT username, public_profile, created_at FROM users WHERE id = $1`, userID,
	).Scan(&resp.Username, &resp.PublicProfile, &createdAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	resp.MemberSince = createdAt.Format("2006-01-02")
	writeJSON(w, http.StatusOK, resp)
}

type publicProfileResponse struct {
	Username        string `json:"username"`
	MemberSince     string `json:"member_since"` // "2006-01-02"
	TotalKeystrokes int    `json:"total_keystrokes"`
	CurrentStreak   int    `json:"current_streak"`
	LongestStreak   int    `json:"longest_streak"`
}

// handlePublicProfile serves GET /v1/users/{username}/public-profile --
// deliberately NO auth required, since the entire point of a "public"
// profile is that it's reachable by a shareable link from someone who
// isn't signed in (or even a KeyCount user) at all. Returns 404 both for
// a username that doesn't exist and for one that exists but hasn't opted
// into public_profile -- the same response either way, so a prober can't
// use this endpoint to distinguish "no such user" from "exists but kept
// private."
func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")

	var userID int64
	var memberSince time.Time
	var isPublic bool
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT id, created_at, public_profile FROM users WHERE username = $1`, username,
	).Scan(&userID, &memberSince, &isPublic)
	if err == sql.ErrNoRows || !isPublic {
		writeError(w, http.StatusNotFound, "no public profile for that username")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load profile")
		return
	}

	resp := publicProfileResponse{
		Username:    username,
		MemberSince: memberSince.Format("2006-01-02"),
	}

	if err := s.DB.QueryRowContext(r.Context(),
		`SELECT COALESCE(SUM(total_keystrokes), 0) FROM daily_rollups WHERE user_id = $1`, userID,
	).Scan(&resp.TotalKeystrokes); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load profile stats")
		return
	}

	// No streaks row yet (never had an active day) just leaves these at
	// zero -- same "ignore the no-rows case" pattern handleMeStats uses.
	_ = s.DB.QueryRowContext(r.Context(),
		`SELECT current_streak, longest_streak FROM streaks WHERE user_id = $1`, userID,
	).Scan(&resp.CurrentStreak, &resp.LongestStreak)

	writeJSON(w, http.StatusOK, resp)
}
