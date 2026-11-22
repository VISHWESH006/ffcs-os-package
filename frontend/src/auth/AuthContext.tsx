import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { firebaseConfigured, observeAuth, reauthenticateWithGoogle, signInWithGoogle, signOutGoogle } from './firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  reauthenticate: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null, loading: false, configured: false, error: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
  reauthenticate: async () => { throw new Error('Authentication is unavailable.'); },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); return; }
    return observeAuth(
      nextUser => { setUser(nextUser); setLoading(false); setError(null); },
      authError => { setLoading(false); setError(authError.message); },
    );
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured: firebaseConfigured,
    error,
    async signIn() {
      setError(null);
      try { await signInWithGoogle(); }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Google sign-in failed.'; setError(message); throw reason; }
    },
    async signOut() {
      setError(null);
      try { await signOutGoogle(); }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Sign-out failed.'; setError(message); throw reason; }
    },
    async reauthenticate() { await reauthenticateWithGoogle(); },
  }), [user, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
