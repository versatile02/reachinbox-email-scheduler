import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, getGoogleAuthUrl } from '../src/services/auth.service.js';
import { extractSessionToken } from '../src/middleware/auth.middleware.js';

describe('Auth Service & Password Hashing Unit Tests', () => {
  test('hashPassword creates a salted scrypt hash and verifyPassword validates it', () => {
    const password = 'SecretPassword123!';
    const hash = hashPassword(password);

    assert.ok(hash.includes(':'), 'Hash must contain salt:key delimiter');
    assert.equal(verifyPassword(password, hash), true, 'Correct password must verify');
    assert.equal(verifyPassword('WrongPassword', hash), false, 'Incorrect password must be rejected');
  });

  test('extractSessionToken extracts from cookies, Bearer authorization, or custom header', () => {
    // 1. From cookie
    const reqWithCookie = {
      cookies: { reachinbox_session: 'session-token-cookie-123' },
      headers: {},
    } as any;
    assert.equal(extractSessionToken(reqWithCookie), 'session-token-cookie-123');

    // 2. From Bearer auth header
    const reqWithBearer = {
      cookies: {},
      headers: { authorization: 'Bearer session-token-bearer-456' },
    } as any;
    assert.equal(extractSessionToken(reqWithBearer), 'session-token-bearer-456');

    // 3. From custom x-session-token header
    const reqWithCustom = {
      cookies: {},
      headers: { 'x-session-token': 'session-token-custom-789' },
    } as any;
    assert.equal(extractSessionToken(reqWithCustom), 'session-token-custom-789');

    // 4. Missing token returns null
    const reqEmpty = { cookies: {}, headers: {} } as any;
    assert.equal(extractSessionToken(reqEmpty), null);
  });

  test('getGoogleAuthUrl generates valid Google OAuth 2.0 URL with required scopes and state', () => {
    const testState = 'oauth-state-token-xyz';
    const authUrl = getGoogleAuthUrl(testState);

    const parsed = new URL(authUrl);
    assert.equal(parsed.origin, 'https://accounts.google.com');
    assert.equal(parsed.pathname, '/o/oauth2/v2/auth');
    assert.equal(parsed.searchParams.get('state'), testState);
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('access_type'), 'offline');
    assert.ok(parsed.searchParams.get('scope')?.includes('userinfo.email'));
    assert.ok(parsed.searchParams.get('scope')?.includes('userinfo.profile'));
  });
});
