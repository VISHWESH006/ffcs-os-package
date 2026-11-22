import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const fakes = vi.hoisted(() => {
  let listener: ((user: unknown) => void) | undefined;
  const user = { uid: 'user-a', email: 'private@example.test' };
  return {
    user,
    getListener: () => listener,
    setListener: (callback: ((user: unknown) => void) | undefined) => { listener = callback; },
    firebaseConfigured: true,
    observeAuth: vi.fn((callback: (user: unknown) => void) => { listener = callback; callback(user); return () => { listener = undefined; }; }),
    signInWithGoogle: vi.fn(async () => { listener?.(user); return user; }),
    signOutGoogle: vi.fn(async () => { listener?.(null); }),
    reauthenticateWithGoogle: vi.fn(async () => undefined),
  };
});

vi.mock('./firebase', () => fakes);

import { AuthGate } from './AuthGate';
import { AuthProvider } from './AuthContext';

describe('Google authentication gate', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('restores an existing Firebase session and renders protected routes', async () => {
    render(<AuthProvider><AuthGate><div>Protected planner</div></AuthGate></AuthProvider>);
    expect(await screen.findByText('Protected planner')).toBeInTheDocument();
    expect(fakes.observeAuth).toHaveBeenCalledOnce();
  });

  it('hides protected content until Google sign-in succeeds and removes it on sign-out', async () => {
    fakes.observeAuth.mockImplementationOnce((callback: (user: unknown) => void) => {
      fakes.setListener(callback);
      // A fresh, signed-out browser session.
      callback(null);
      return () => undefined;
    });
    function Harness() {
      const { signOut } = useAuthForTest();
      return <><button onClick={() => void signOut()}>Sign out</button><AuthGate><div>Protected planner</div></AuthGate></>;
    }
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(screen.queryByText('Protected planner')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Protected planner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });
});

import { useAuth as useAuthForTest } from './AuthContext';
