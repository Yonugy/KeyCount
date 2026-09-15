// Thin fetch wrapper around the KeyCount Go backend (see ../backend).
// No axios/etc -- the API surface is small enough that plain fetch is
// simpler and has zero extra dependencies.

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

const TOKEN_KEY = "keycount_token";
const REFRESH_TOKEN_KEY = "keycount_refresh_token";
const USERNAME_KEY = "keycount_username";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function setSession(token: string, refreshToken: string, username: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Added 2026-09-02 (the multi-user/leaderboards phase): the backend now
// issues a short-lived (15min) access token plus a long-lived (30-day,
// rotating) refresh token instead of one flat 7-day JWT -- see auth.go's
// own note on why. That means a request can now fail with 401 simply
// because the access token aged out mid-session, not just because the
// user was never signed in -- request() below transparently exchanges
// the refresh token for a new pair and retries once before giving up,
// so an expired access token is invisible to every call site; they still
// just get back data or a real ApiError.
//
// refreshPromise de-dupes concurrent refreshes: if three queries all hit
// a 401 around the same moment, only the first actually calls
// /v1/auth/refresh (which rotates and invalidates the token it's given --
// see auth.go) and the other two await that same in-flight promise
// instead of racing to spend an already-rotated refresh token against
// each other.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    throw new ApiError(401, "Not signed in.");
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        throw new ApiError(res.status, "Your session expired -- please sign in again.");
      }
      const body: AuthResponse = await res.json();
      setSession(body.token, body.refresh_token, body.username);
      return body.token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, isRetryAfterRefresh = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  // Try exactly one silent refresh-and-retry per request -- never for the
  // refresh call itself (that would loop), never on a second attempt
  // (isRetryAfterRefresh), and only when there's actually a refresh token
  // to try (an anonymous call, e.g. fetchPublicProfile with nobody signed
  // in on this browser, should just surface its 401/404 normally).
  if (res.status === 401 && !isRetryAfterRefresh && path !== "/v1/auth/refresh" && getRefreshToken()) {
    await refreshAccessToken(); // throws (and clears session) if the refresh itself fails
    return request<T>(path, options, true);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON, keep the generic message
    }
    if (res.status === 401) clearSession();
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// --- types, matching the backend's JSON shapes exactly -------------------

export interface AuthResponse {
  token: string;
  refresh_token: string;
  user_id: number;
  username: string;
}

export interface Stats {
  range: string;
  total_keystrokes: number;
  total_clicks: number;
  active_minutes: number;
  current_streak: number;
  longest_streak: number;
  // Added 2026-09-07 for the Week/Month/All-time "daily average" row --
  // active_days is how many days in the range had any recorded activity
  // (the avg_* fields are already divided by it, not by the range's full
  // calendar length -- see the backend's own comment on why).
  active_days: number;
  avg_keystrokes: number;
  avg_clicks: number;
  avg_active_minutes: number;
}

export interface AppStat {
  app_name: string;
  keystrokes: number;
  clicks: number;
}

export interface DayStat {
  date: string; // YYYY-MM-DD
  total_keystrokes: number;
  total_clicks: number;
  active_minutes: number;
}

// One point per minute that actually had activity (sparse -- a quiet
// minute just doesn't appear rather than showing up as a zero). The
// caller is responsible for supplying since/until in its OWN timezone
// terms and for bucketing bucket_start_ts back into local hours -- this
// endpoint does no timezone math at all, see day_buckets.go's handler
// comment on the backend.
export interface DayBucketPoint {
  bucket_start_ts: number; // unix seconds, UTC instant
  keystrokes: number;
  clicks: number;
}

export type Range = "today" | "week" | "month" | "all";

// --- leaderboards & public profiles (2026-09-02) --------------------------

// Global rankings -- every registered user, no friendship gating (see
// leaderboards.go's own note on that scope decision). `public_profile`
// on each entry is what a UI uses to decide whether that row should link
// anywhere -- an entry with public_profile: false has no profile page to
// show (fetchPublicProfile would just 404 for them).
export interface LeaderboardEntry {
  rank: number;
  username: string;
  value: number;
  public_profile: boolean;
}

export type LeaderboardWindow = "daily" | "weekly" | "alltime";

// "friends" scope added 2026-09-11 alongside the friendships feature
// (FriendsView.tsx) -- see leaderboards.go's own note on what it
// includes (you plus your accepted friends).
export type LeaderboardScope = "global" | "friends";

export interface Settings {
  username: string;
  public_profile: boolean;
  // Added 2026-09-02, second time the same day -- the authenticated
  // "Profile" tab needs this regardless of public_profile (unlike
  // PublicProfile below, which is fetched from a route that 404s while
  // private -- exactly the case this field exists to route around), and
  // /v1/me/settings was already the endpoint returning your own account-
  // identity fields, so it grew this rather than a new one-off endpoint.
  member_since: string; // YYYY-MM-DD
}

export interface PublicProfile {
  username: string;
  member_since: string; // YYYY-MM-DD
  total_keystrokes: number;
  current_streak: number;
  longest_streak: number;
}

// Friendships (2026-09-11, request/accept model -- see backend/friends.go).
// Same shape used for an accepted friend, an incoming request, and an
// outgoing request -- which list it's in is what distinguishes them, the
// entry itself doesn't carry a status field.
export interface FriendEntry {
  username: string;
  public_profile: boolean;
}

export interface FriendsList {
  friends: FriendEntry[];
  incoming_requests: FriendEntry[];
  outgoing_requests: FriendEntry[];
}

// --- calls -----------------------------------------------------------

export function login(email: string, password: string) {
  return request<AuthResponse>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(email: string, username: string, password: string) {
  return request<AuthResponse>("/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}

export function fetchStats(range: Range) {
  return request<Stats>(`/v1/me/stats?range=${range}`);
}

export function fetchAppsBreakdown(range: Range) {
  return request<AppStat[]>(`/v1/me/apps-breakdown?range=${range}`);
}

export function fetchHistory(days: number) {
  return request<DayStat[]>(`/v1/me/history?days=${days}`);
}

// since/until are unix seconds bounding the exact window to fetch -- see
// utils.ts's localDayBoundsUnix() for computing "one local calendar day"
// in those terms.
export function fetchDayBuckets(sinceTs: number, untilTs: number) {
  return request<DayBucketPoint[]>(`/v1/me/day-buckets?since=${sinceTs}&until=${untilTs}`);
}

// Per-app keystroke/click totals for the exact same one-local-calendar-day
// window as fetchDayBuckets (same since/until contract -- see that
// function's own note). Added 2026-09-02 as the payoff of the per-app
// sync accuracy fix (see agent.py's flush_bucket and ingest.go's
// active_minutes dedup, both changed the same day): unlike
// fetchAppsBreakdown's `range` param (which resolves "today" as UTC
// midnight on the backend -- wrong for browsing a specific LOCAL day, the
// same bug the local_date fix addressed elsewhere), this always takes an
// exact instant window the caller already computed in local-day terms.
// Reuses AppStat's shape (`{app_name, keystrokes, clicks}`) since the
// backend's day-apps JSON is identical to apps-breakdown's.
export function fetchDayApps(sinceTs: number, untilTs: number) {
  return request<AppStat[]>(`/v1/me/day-apps?since=${sinceTs}&until=${untilTs}`);
}

export function fetchLeaderboardKeystrokes(window: LeaderboardWindow, scope: LeaderboardScope = "global") {
  return request<LeaderboardEntry[]>(`/v1/leaderboards/keystrokes?window=${window}&scope=${scope}`);
}

export function fetchLeaderboardStreak(scope: LeaderboardScope = "global") {
  return request<LeaderboardEntry[]>(`/v1/leaderboards/streak?scope=${scope}`);
}

export function fetchSettings() {
  return request<Settings>("/v1/me/settings");
}

export function updatePublicProfile(publicProfile: boolean) {
  return request<Settings>("/v1/me/settings", {
    method: "PATCH",
    body: JSON.stringify({ public_profile: publicProfile }),
  });
}

// Deliberately callable with nobody signed in -- request() only attaches
// an Authorization header when a token happens to be present, and the
// backend's handlePublicProfile doesn't require one at all (see its own
// comment: that's the entire point of a "public" profile page).
export function fetchPublicProfile(username: string) {
  return request<PublicProfile>(`/v1/users/${encodeURIComponent(username)}/public-profile`);
}

export function fetchFriends() {
  return request<FriendsList>("/v1/friends");
}

export function sendFriendRequest(username: string) {
  return request<{ status: string }>("/v1/friends/request", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

// Also used to cancel a request YOU sent -- the backend's decline
// endpoint works from either side of a pending request, see its own
// comment. FriendsView.tsx calls this same function for both the
// addressee's "Decline" button and the requester's "Cancel" button.
export function declineFriendRequest(username: string) {
  return request<{ status: string }>(`/v1/friends/${encodeURIComponent(username)}/decline`, {
    method: "POST",
  });
}

export function acceptFriendRequest(username: string) {
  return request<{ status: string }>(`/v1/friends/${encodeURIComponent(username)}/accept`, {
    method: "POST",
  });
}

export function removeFriend(username: string) {
  return request<{ status: string }>(`/v1/friends/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}
