import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({ currentFirebaseIdToken: vi.fn(async () => 'signed-firebase-id-token') }));
vi.mock('../auth/firebase', () => firebase);

import { checkApiHealth, parseImport } from './client';

describe('authenticated API client', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('sends the current Firebase ID token with planner API requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: '1.5.0' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await parseImport('{"schemaVersion":"1.5.0"}');
    expect(firebase.currentFirebaseIdToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/parse', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer signed-firebase-id-token' }),
    }));
  });

  it('keeps the liveness endpoint public', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkApiHealth()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/healthz');
    expect(firebase.currentFirebaseIdToken).not.toHaveBeenCalled();
  });
});
