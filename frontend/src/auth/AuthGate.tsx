import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, GraduationCap, LoaderCircle, LogIn, ShieldCheck, Sparkles } from 'lucide-react';
import { trackPageView } from '../analytics';
import { useAuth } from './AuthContext';

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, error, signIn } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!loading && !user) trackPageView('login');
  }, [loading, user]);

  if (loading) return <main className="auth-screen"><div className="auth-shell"><AuthMasthead /><div className="auth-loading auth-glass"><LoaderCircle className="spin" size={22} /><p>Restoring your sign-in…</p></div></div></main>;
  if (!configured) return <AuthLayout><section className="auth-card auth-glass"><div className="auth-card-icon"><ShieldCheck size={21} /></div><p className="auth-kicker">SECURE ACCESS</p><h2>Sign-in setup required</h2><p>Firebase web configuration is missing. Set the VITE_FIREBASE_* values in the frontend environment and rebuild.</p></section></AuthLayout>;
  if (!user) return <AuthLayout><section className="auth-card auth-glass">
    <div className="auth-card-icon"><CalendarDays size={21} /></div>
    <p className="auth-kicker">YOUR FFCS WORKSPACE</p>
    <h2>Welcome to a clearer semester.</h2>
    <p className="auth-card-copy">Sign in to build conflict-aware schedules, compare your options, and keep your saved timetables close.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="auth-google-button" disabled={signingIn} onClick={async () => { setSigningIn(true); try { await signIn(); } catch { /* surfaced in the auth context */ } finally { setSigningIn(false); } }}>
      <span className="auth-google-leading">{signingIn ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}</span>
      <span>{signingIn ? 'Connecting to Google…' : 'Continue with Google'}</span>
      {!signingIn && <span className="auth-google-arrow"><ArrowRight size={17} /></span>}
    </button>
    <div className="auth-privacy"><ShieldCheck size={15} /><span>Your saved timetables are private to your account.</span></div>
    <small className="auth-legal">By continuing, you agree to use FFCS OS for personal timetable planning. See the privacy and account deletion information.</small>
  </section></AuthLayout>;
  return <>{children}</>;
}

function AuthMasthead() {
  return <header className="auth-masthead auth-glass">
    <a className="auth-brand" href="/" aria-label="FFCS OS home"><span className="auth-brand-mark"><GraduationCap size={19} /></span><span>FFCS OS</span></a>
    <span className="auth-masthead-label">STUDENT TIMETABLE PLANNER</span>
    <span className="auth-masthead-status"><span />PRIVATE WORKSPACE</span>
  </header>;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-screen"><div className="auth-shell">
    <AuthMasthead />
    <div className="auth-layout">
      <section className="auth-intro">
        <div className="auth-version-pill"><Sparkles size={14} /> A calmer way to plan FFCS</div>
        <h1>Make room for a <span>better week.</span></h1>
        <p className="auth-intro-copy">Explore timetable combinations, check clashes, and choose the faculty offering that works for you.</p>
        <div className="auth-feature-list">
          <div><span><Check size={14} /></span><p><b>See the whole week</b><small>Compare real class times, not just slot codes.</small></p></div>
          <div><span><Check size={14} /></span><p><b>Choose your offering</b><small>Pick among available faculty and slot options.</small></p></div>
          <div><span><Check size={14} /></span><p><b>Keep plans private</b><small>Your saved timetables belong to your account.</small></p></div>
        </div>
        <div className="auth-footnote"><span className="auth-footnote-mark"><ShieldCheck size={16} /></span><span>Built for thoughtful semester planning<br /><small>VIT Bhopal · Student workspace</small></span></div>
      </section>
      {children}
    </div>
    <footer className="auth-footer"><span>FFCS OS <i>·</i> Plan clearly. Choose confidently.</span><span>Secure Google sign-in</span></footer>
  </div></main>;
}
