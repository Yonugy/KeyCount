package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type signupRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	UserID       int64  `json:"user_id"`
	Username     string `json:"username"`
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Email == "" || req.Username == "" || len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "email, username and a password of at least 8 characters are required")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}

	var userID int64
	err = s.DB.QueryRowContext(r.Context(),
		`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		req.Email, req.Username, string(hash),
	).Scan(&userID)
	if err != nil {
		writeError(w, http.StatusConflict, "email or username already in use")
		return
	}

	access, refresh, err := s.issueTokenPair(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}

	writeJSON(w, http.StatusCreated, authResponse{Token: access, RefreshToken: refresh, UserID: userID, Username: req.Username})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	var userID int64
	var username, hash string
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT id, username, password_hash FROM users WHERE email = $1`, req.Email,
	).Scan(&userID, &username, &hash)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	access, refresh, err := s.issueTokenPair(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{Token: access, RefreshToken: refresh, UserID: userID, Username: username})
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// handleRefresh serves POST /v1/auth/refresh -- no bearer auth of its own,
// the refresh token in the body IS the credential (same trust model as a
// device token). Rotates on every use: the presented token is revoked and
// a brand new (access, refresh) pair is issued, rather than minting a
// fresh access token off the same refresh token indefinitely. That means a
// stolen-but-unused refresh token becomes useless the moment the real
// client refreshes again (its own next refresh attempt fails with "already
// used"), which is the standard signal that a token has leaked -- see the
// note on refresh_tokens in db.go.
func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "refresh_token is required")
		return
	}

	hash := hashToken(req.RefreshToken)

	ctx := r.Context()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start transaction")
		return
	}
	defer tx.Rollback() //nolint:errcheck -- no-op once committed

	var tokenID, userID int64
	var expiresAt time.Time
	var revokedAt sql.NullTime
	err = tx.QueryRowContext(ctx,
		`SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`, hash,
	).Scan(&tokenID, &userID, &expiresAt, &revokedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not look up refresh token")
		return
	}
	if revokedAt.Valid {
		writeError(w, http.StatusUnauthorized, "refresh token already used")
		return
	}
	if time.Now().After(expiresAt) {
		writeError(w, http.StatusUnauthorized, "refresh token expired")
		return
	}

	var username string
	if err := tx.QueryRowContext(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load user")
		return
	}

	if _, err := tx.ExecContext(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, tokenID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke refresh token")
		return
	}

	newRefresh, err := issueRefreshTokenTx(ctx, tx, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue refresh token")
		return
	}

	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not commit transaction")
		return
	}

	access, err := s.issueAccessToken(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{Token: access, RefreshToken: newRefresh, UserID: userID, Username: username})
}

// accessTokenTTL is deliberately short -- the whole point of adding a
// refresh flow (2026-09-02, the multi-user/leaderboards phase) is that a
// leaked access token now only has a 15-minute blast radius instead of the
// old flat 7 days, since other people's browsers/devices are talking to
// this API for the first time as of this phase. refreshTokenTTL is the
// "how long can you stay signed in without re-entering your password"
// window -- 30 days, rotated on every use (see handleRefresh).
const (
	accessTokenTTL  = 15 * time.Minute
	refreshTokenTTL = 30 * 24 * time.Hour
)

// issueTokenPair is the entry point used by signup/login -- there's no
// existing refresh_tokens row to revoke yet (unlike handleRefresh's
// rotation), so it just issues fresh access + refresh tokens straight
// against s.DB.
func (s *Server) issueTokenPair(ctx context.Context, userID int64) (access, refresh string, err error) {
	access, err = s.issueAccessToken(userID)
	if err != nil {
		return "", "", err
	}
	refresh, err = issueRefreshTokenTx(ctx, s.DB, userID)
	if err != nil {
		return "", "", err
	}
	return access, refresh, nil
}

// issueAccessToken hands back a short-lived JWT -- see accessTokenTTL.
func (s *Server) issueAccessToken(userID int64) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(accessTokenTTL).Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.JWTSecret)
}

// dbTx is satisfied by both *sql.DB and *sql.Tx -- issueRefreshTokenTx runs
// either as its own implicit transaction (signup/login, via s.DB) or as
// part of an existing one (handleRefresh's rotation, via its own tx), the
// same pattern the rest of this codebase uses for ExecContext on either
// interchangeably.
type dbTx interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// issueRefreshTokenTx generates a fresh opaque refresh token (the same
// randomToken() helper devices.go uses for device tokens), stores its hash
// (never the raw value -- see db.go's note on refresh_tokens), and returns
// the raw token for the response body. The raw value is the only place it
// ever exists outside the client -- it can't be recovered from the stored
// hash, same as a device token or a bcrypt'd password.
func issueRefreshTokenTx(ctx context.Context, db dbTx, userID int64) (string, error) {
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	_, err = db.ExecContext(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hashToken(raw), time.Now().Add(refreshTokenTTL),
	)
	if err != nil {
		return "", err
	}
	return raw, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

type ctxKey string

const userIDKey ctxKey = "user_id"

// requireUser wraps a handler so it only runs for requests carrying a valid
// "Authorization: Bearer <jwt>" header issued by issueAccessToken, and
// exposes the authenticated user's id via userIDKey in the request context.
func (s *Server) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			return s.JWTSecret, nil
		})
		if err != nil || !token.Valid {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid token claims")
			return
		}
		sub, ok := claims["sub"].(float64)
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid token subject")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, int64(sub))
		next(w, r.WithContext(ctx))
	}
}
