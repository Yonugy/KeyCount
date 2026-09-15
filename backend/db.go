package main

import "database/sql"

// schema matches the core tables from architecture/keycount-system-design.md
// section 4.4, adjusted for what Phase 2 (auth + ingest + stats) needs.
// friendships was intentionally left uncreated through Phase 4's initial
// leaderboards work (global-only, scope decision documented in
// leaderboards.go) -- added 2026-09-11 once friends-only leaderboards
// were actually requested. See friends.go for the request/accept flow.
const schema = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    public_profile BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    device_token TEXT UNIQUE NOT NULL,
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_buckets (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    app_name TEXT NOT NULL,
    keystrokes INTEGER NOT NULL DEFAULT 0,
    backspaces INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    mouse_distance INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, bucket_start, device_id, app_name)
);

CREATE TABLE IF NOT EXISTS daily_rollups (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_keystrokes INTEGER NOT NULL DEFAULT 0,
    total_clicks INTEGER NOT NULL DEFAULT 0,
    active_minutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS streaks (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_active_date DATE
);

-- Added for the real refresh-token flow (2026-09-02, the multi-user/
-- leaderboards phase) -- see auth.go's own note on why a flat 7-day JWT
-- with no refresh wasn't good enough once other people's devices started
-- talking to this API. token_hash stores SHA-256(refresh token), never
-- the raw token -- same reasoning as device_token being opaque and
-- password_hash being bcrypt: a leaked row (DB dump, log line) shouldn't
-- itself be a usable credential. revoked_at is set on rotation (every
-- successful /v1/auth/refresh revokes the token it was given and issues
-- a new one) or could be set by a future explicit logout/"sign out other
-- devices" endpoint -- not built yet, the column is ready for it.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

-- Request/accept model (2026-09-11, direct request), one row per request
-- regardless of who sent it: requester_id sends to addressee_id, status
-- starts 'pending', and moves to 'accepted' in place (never a second
-- row) once addressee_id accepts -- see friends.go for why a single row
-- flipped in place, rather than a mirrored second row, was simpler to
-- keep consistent. A declined or cancelled request just deletes the row
-- rather than leaving a 'declined' tombstone -- there's nothing useful
-- to show from "X declined Y once," and it lets the same pair request
-- each other again later without a stale row in the way. The unordered
-- CHECK below stops the same pair from ending up with two rows in
-- opposite directions (A->B and B->A) representing what's really one
-- relationship -- friends.go's lookups always check both directions
-- explicitly instead of relying on which side happens to be
-- requester_id.
CREATE TABLE IF NOT EXISTS friendships (
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_unordered_pair
    ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
`

// RunMigrations applies the schema. It's plain idempotent DDL (CREATE TABLE
// IF NOT EXISTS) rather than a versioned migration tool -- good enough for
// this stage; swap in golang-migrate/goose once the schema needs to evolve
// with real data in it.
func RunMigrations(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}
