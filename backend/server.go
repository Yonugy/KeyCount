package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Server holds shared dependencies for all HTTP handlers.
type Server struct {
	DB            *sql.DB
	JWTSecret     []byte
	ingestLimiter *rateLimiter // see ratelimit.go
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
