package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

type registerDeviceRequest struct {
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

type registerDeviceResponse struct {
	DeviceID    int64  `json:"device_id"`
	DeviceToken string `json:"device_token"`
}

// handleRegisterDevice ties a new device to the authenticated user and
// hands back an opaque device_token. The agent stores that token and uses
// it (not the user's login JWT) to authenticate /v1/ingest/batch calls.
func (s *Server) handleRegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	var req registerDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		req.Name = "unnamed device"
	}
	if req.Platform == "" {
		req.Platform = "unknown"
	}

	deviceToken, err := randomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate device token")
		return
	}

	var deviceID int64
	err = s.DB.QueryRowContext(r.Context(),
		`INSERT INTO devices (user_id, name, platform, device_token) VALUES ($1, $2, $3, $4) RETURNING id`,
		userID, req.Name, req.Platform, deviceToken,
	).Scan(&deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not register device")
		return
	}

	writeJSON(w, http.StatusCreated, registerDeviceResponse{DeviceID: deviceID, DeviceToken: deviceToken})
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type deviceCtxKey string

const (
	deviceIDKey     deviceCtxKey = "device_id"
	deviceUserIDKey deviceCtxKey = "device_user_id"
)

// requireDevice wraps a handler so it only runs for requests carrying a
// valid "Authorization: Bearer <device_token>" header from
// handleRegisterDevice, and exposes the device's id and owning user's id in
// the request context.
func (s *Server) requireDevice(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing bearer device token")
			return
		}
		deviceToken := strings.TrimPrefix(authHeader, "Bearer ")

		var deviceID, userID int64
		err := s.DB.QueryRowContext(r.Context(),
			`UPDATE devices SET last_seen_at = now() WHERE device_token = $1 RETURNING id, user_id`,
			deviceToken,
		).Scan(&deviceID, &userID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid device token")
			return
		}

		ctx := context.WithValue(r.Context(), deviceIDKey, deviceID)
		ctx = context.WithValue(ctx, deviceUserIDKey, userID)
		next(w, r.WithContext(ctx))
	}
}
