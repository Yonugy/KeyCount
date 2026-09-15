import { Navigate, Route, Routes, useParams } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import RequireAuth from "./components/RequireAuth";
import LoginRoute from "./components/LoginRoute";
import PublicProfilePage from "./components/PublicProfilePage";
import LandingPage from "./components/LandingPage";
import FeaturesPage from "./components/FeaturesPage";
import DownloadPage from "./components/DownloadPage";

// Routing phase 2 (2026-09-13): "/" is now the real landing page, not
// phase 1's RootRedirect placeholder -- it renders for every visitor,
// signed in or not, per direct decision (LandingPage itself shows a
// "go to your dashboard" link when signed in, rather than the page
// redirecting the visitor away). /features and /download are new public
// pages alongside it, all three sharing PublicNav.
//
// /login, /u/:username, and /app are unchanged from phase 1: LoginRoute
// still wraps Login.tsx with navigation, RequireAuth still guards /app,
// and PublicProfilePage still takes its username from a real route param.
//
// Vite's SPA history-fallback (appType: "spa", both `npm run dev` and
// `vite preview`) still serves this same index.html for a hard refresh
// on any of these paths.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/u/:username" element={<PublicProfileRoute />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// /u/:username is reachable with nobody signed in (see PublicProfilePage's
// own comment: that's the entire point of a public profile link), so it
// sits outside RequireAuth entirely, same as it always has.
function PublicProfileRoute() {
  const { username } = useParams<{ username: string }>();
  return <PublicProfilePage username={decodeURIComponent(username ?? "")} />;
}
