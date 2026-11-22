import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(value => typeof value === 'string' && value.trim().length > 0);
const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;
export const firebaseAuth = app ? getAuth(app) : null;

export async function signInWithGoogle(): Promise<User> {
  if (!firebaseAuth) throw new Error('Firebase web configuration is missing.');
  await setPersistence(firebaseAuth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(firebaseAuth, provider)).user;
}

export async function reauthenticateWithGoogle(): Promise<void> {
  if (!firebaseAuth?.currentUser) throw new Error('Sign in before continuing.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await reauthenticateWithPopup(firebaseAuth.currentUser, provider);
  // Account deletion is protected by the server's recent-authentication check.
  await firebaseAuth.currentUser.getIdToken(true);
}

export async function signOutGoogle(): Promise<void> {
  if (firebaseAuth) await signOut(firebaseAuth);
}

export function observeAuth(callback: (user: User | null) => void, onError: (error: Error) => void) {
  if (!firebaseAuth) return () => undefined;
  return onAuthStateChanged(firebaseAuth, callback, onError);
}

export async function currentFirebaseIdToken(): Promise<string> {
  if (!firebaseAuth?.currentUser) throw new Error('Sign in to continue.');
  return firebaseAuth.currentUser.getIdToken();
}
