import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getToken, setSession } from "../api";
import Login from "./Login";

// Thin routing wrapper around Login.tsx (2026-09-13, routing phase 1).
// Login itself is unchanged -- it doesn't know about the router at all,
// it just calls onAuthed with the new tokens like it always has. This is
// the only part that's new: save the session, then navigate to wherever
// RequireAuth originally bounced the visitor from (location.state.from),
// or /app by default for a direct visit to /login.
export default function LoginRoute() {
  const navigate = useNavigate();
  const location = useLocation();

  // Already signed in and landed on /login anyway (e.g. a stale bookmark,
  // or clicking browser back) -- skip the form, go straight to the app.
  if (getToken()) {
    return <Navigate to="/app" replace />;
  }

  function handleAuthed(token: string, refreshToken: string, username: string) {
    setSession(token, refreshToken, username);
    const from = (location.state as { from?: { pathname: string; search: string } })?.from;
    navigate(from ? `${from.pathname}${from.search}` : "/app", { replace: true });
  }

  return <Login onAuthed={handleAuthed} />;
}
