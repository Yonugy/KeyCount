import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../api";

// Guards every /app/* route (2026-09-13, routing phase 1). Anything under
// /app needs a valid token or it bounces to /login -- this is the one
// place that decision gets made now, replacing the old "if (!token) return
// <Login />" check that used to sit at the top of App.tsx and gate the
// entire site, landing page and all, behind being signed in.
//
// Carries the page the visitor was trying to reach via router state so
// /login can send them back afterward instead of always dropping them on
// the dashboard's default tab -- not wired up by Login.tsx yet (it always
// navigates to "/app" on success), but the state is here so that's a
// one-line follow-up rather than a new mechanism.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
