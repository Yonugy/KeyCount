package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Request/accept friendships (2026-09-11, direct request, the last piece
// of the design doc's "multi-user + leaderboards" milestone: leaderboards
// launched global-only, see leaderboards.go's own note, with friendships
// deliberately deferred). One row per pair in `friendships` (db.go),
// requester_id -> addressee_id, status 'pending' until addressee_id
// accepts. All four endpoints below take the OTHER user's username in
// the path/body rather than a numeric friendship id -- the frontend
// never needs to know a friendship row's id, just "the person with this
// username," which also lets accept/decline/remove share one lookup
// shape.

type friendEntry struct {
	Username      string `json:"username"`
	PublicProfile bool   `json:"public_profile"`
}

// lookupUserByUsername is the same username->id/public_profile lookup
// settings.go's handlePublicProfile does inline, factored out here since
// every handler below needs it at least once (and accept/decline/remove
// need it before they can even look up the friendships row).
func lookupUserByUsername(w http.ResponseWriter, r *http.Request, db *sql.DB, username string) (id int64, publicProfile bool, ok bool) {
	err := db.QueryRowContext(r.Context(),
		`SELECT id, public_profile FROM users WHERE username = $1`, username,
	).Scan(&id, &publicProfile)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "no user with that username")
		return 0, false, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not look up user")
		return 0, false, false
	}
	return id, publicProfile, true
}

type sendFriendRequestRequest struct {
	Username string `json:"username"`
}

// handleSendFriendRequest serves POST /v1/friends/request {"username": "..."}.
// Rejects a self-request, an already-pending request in either direction
// (with a message pointing at accept instead, if the OTHER person
// already requested you), and an already-accepted friendship -- each
// with its own 409 message rather than one generic "conflict," since the
// fix is different each time (wait, accept, or nothing to do).
func (s *Server) handleSendFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	var req sendFriendRequestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" {
		writeError(w, http.StatusBadRequest, "username is required")
		return
	}

	targetID, _, ok := lookupUserByUsername(w, r, s.DB, req.Username)
	if !ok {
		return
	}
	if targetID == userID {
		writeError(w, http.StatusBadRequest, "can't send a friend request to yourself")
		return
	}

	var existingStatus string
	var existingRequester int64
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT status, requester_id FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
		userID, targetID,
	).Scan(&existingStatus, &existingRequester)
	if err != nil && err != sql.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "could not check existing friendship")
		return
	}
	if err == nil {
		switch {
		case existingStatus == "accepted":
			writeError(w, http.StatusConflict, "already friends with that user")
		case existingRequester == userID:
			writeError(w, http.StatusConflict, "friend request already sent")
		default:
			writeError(w, http.StatusConflict, "that user already sent you a request -- accept it instead of sending a new one")
		}
		return
	}

	if _, err := s.DB.ExecContext(r.Context(),
		`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
		userID, targetID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "could not send friend request")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "pending"})
}

// handleAcceptFriendRequest serves POST /v1/friends/{username}/accept --
// {username} is the person who sent the request. Only the addressee can
// accept (a requester trying to "accept" their own outgoing request gets
// the same 404 as a request that doesn't exist -- there's nothing to
// accept from that side).
func (s *Server) handleAcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)
	requesterID, _, ok := lookupUserByUsername(w, r, s.DB, r.PathValue("username"))
	if !ok {
		return
	}

	result, err := s.DB.ExecContext(r.Context(),
		`UPDATE friendships SET status = 'accepted', responded_at = now()
		 WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
		requesterID, userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not accept friend request")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "no pending request from that user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}

// handleDeclineFriendRequest serves POST /v1/friends/{username}/decline.
// Deliberately works from either side of a pending request: the
// addressee declining an incoming one, or the requester cancelling their
// own outgoing one, are the same operation on this row (delete a pending
// request between these two users) and the frontend doesn't need two
// endpoints to express two use cases that look identical from here.
func (s *Server) handleDeclineFriendRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)
	otherID, _, ok := lookupUserByUsername(w, r, s.DB, r.PathValue("username"))
	if !ok {
		return
	}

	result, err := s.DB.ExecContext(r.Context(),
		`DELETE FROM friendships
		 WHERE status = 'pending'
		   AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
		userID, otherID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not decline friend request")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "no pending request with that user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "declined"})
}

// handleRemoveFriend serves DELETE /v1/friends/{username} -- unfriends
// an already-accepted friendship. Works from either side, same reasoning
// as decline above (there's no meaningful "who unfriended whom" to
// preserve once the row's gone).
func (s *Server) handleRemoveFriend(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)
	otherID, _, ok := lookupUserByUsername(w, r, s.DB, r.PathValue("username"))
	if !ok {
		return
	}

	result, err := s.DB.ExecContext(r.Context(),
		`DELETE FROM friendships
		 WHERE status = 'accepted'
		   AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
		userID, otherID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not remove friend")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "not friends with that user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

type friendsListResponse struct {
	Friends          []friendEntry `json:"friends"`
	IncomingRequests []friendEntry `json:"incoming_requests"`
	OutgoingRequests []friendEntry `json:"outgoing_requests"`
}

// handleListFriends serves GET /v1/friends -- everything the Friends tab
// needs in one call: accepted friends, requests waiting on you to
// answer, and requests you're waiting on someone else to answer. Three
// separate queries rather than one UNION -- each has different join
// direction and status filtering, and at a friends-list scale (never
// going to be thousands of rows for one user) there's no reason to force
// them into one query for it.
func (s *Server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)
	resp := friendsListResponse{
		Friends:          []friendEntry{},
		IncomingRequests: []friendEntry{},
		OutgoingRequests: []friendEntry{},
	}

	friendRows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.username, u.public_profile
		 FROM friendships f
		 JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
		 WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
		 ORDER BY u.username`,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load friends")
		return
	}
	for friendRows.Next() {
		var e friendEntry
		if err := friendRows.Scan(&e.Username, &e.PublicProfile); err != nil {
			friendRows.Close()
			writeError(w, http.StatusInternalServerError, "could not read friends")
			return
		}
		resp.Friends = append(resp.Friends, e)
	}
	friendRows.Close()

	incomingRows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.username, u.public_profile
		 FROM friendships f JOIN users u ON u.id = f.requester_id
		 WHERE f.status = 'pending' AND f.addressee_id = $1
		 ORDER BY f.created_at`,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load incoming requests")
		return
	}
	for incomingRows.Next() {
		var e friendEntry
		if err := incomingRows.Scan(&e.Username, &e.PublicProfile); err != nil {
			incomingRows.Close()
			writeError(w, http.StatusInternalServerError, "could not read incoming requests")
			return
		}
		resp.IncomingRequests = append(resp.IncomingRequests, e)
	}
	incomingRows.Close()

	outgoingRows, err := s.DB.QueryContext(r.Context(),
		`SELECT u.username, u.public_profile
		 FROM friendships f JOIN users u ON u.id = f.addressee_id
		 WHERE f.status = 'pending' AND f.requester_id = $1
		 ORDER BY f.created_at`,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load outgoing requests")
		return
	}
	for outgoingRows.Next() {
		var e friendEntry
		if err := outgoingRows.Scan(&e.Username, &e.PublicProfile); err != nil {
			outgoingRows.Close()
			writeError(w, http.StatusInternalServerError, "could not read outgoing requests")
			return
		}
		resp.OutgoingRequests = append(resp.OutgoingRequests, e)
	}
	outgoingRows.Close()

	writeJSON(w, http.StatusOK, resp)
}
