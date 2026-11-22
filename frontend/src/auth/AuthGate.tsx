import { useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, LoaderCircle, LogIn } from 'lucide-react';
import { trackPageView } from '../analytics';
import { useAuth } from './AuthContext';

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, error, signIn } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!loading && !user) trackPageView('login');
  }, [loading, user]);

  if (loading) return <main className="auth-screen"><div className="auth-card"><LoaderCircle className="spin" size={22} /><p>Restoring your sign-in…</p></div></main>;
  if (!configured) return <main className="auth-screen"><section className="auth-card"><span className="auth-brand"><GraduationCap size={23} />FFCS OS</span><h1>Sign-in setup required</h1><p>Firebase web configuration is missing. Set the VITE_FIREBASE_* values in the frontend environment and rebuild.</p></section></main>;
  if (!user) return <main className="auth-screen"><section className="auth-card"><span className="auth-brand"><GraduationCap size={23} />FFCS OS</span><h1>Sign in to plan your timetable</h1><p>Use any Google account to access your private planner and saved timetables.</p>{error && <p className="auth-error" role="alert">{error}</p>}<button className="btn btn-primary auth-google-button" disabled={signingIn} onClick={async () => { setSigningIn(true); try { await signIn(); } catch { /* surfaced in the auth context */ } finally { setSigningIn(false); } }}>{signingIn ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}Continue with Google</button><small>Your saved timetables are private to your account. See the privacy and account deletion information.</small></section></main>;
  return <>{children}</>;
}
