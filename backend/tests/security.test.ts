import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { emailRepository, DEFAULT_USER_ID } from '../src/models/email.repository.js';
import { authService } from '../src/services/auth.service.js';
import { config } from '../src/config/index.js';

let server: http.Server;
let baseUrl: string;

const request = ({
  method = 'GET',
  path,
  headers = {},
  body,
}: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; text: string }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = rawData ? JSON.parse(rawData) : {};
          } catch {
            parsed = null;
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
            text: rawData,
          });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
};

describe('Focused Security & Authorization Regression Tests', () => {
  const originalValidateSession = authService.validateSession;
  const originalListSenders = emailRepository.listSenders;
  const originalGetSenderByEmail = emailRepository.getSenderByEmail;
  const originalCreateSender = emailRepository.createSender;

  before(async () => {
    // Configure test admin credentials
    config.admin.user = 'testadmin';
    config.admin.password = 'supersecretadminpass123';
    config.admin.apiKey = 'adminkey_secure_999';
    config.admin.emails = ['oliver.brown@domain.io', 'admin@reachinbox.ai'];

    server = app.listen(0);
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    authService.validateSession = originalValidateSession;
    emailRepository.listSenders = originalListSenders;
    emailRepository.getSenderByEmail = originalGetSenderByEmail;
    emailRepository.createSender = originalCreateSender;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ========================================================
  // 1. Bull Board Protection Tests (/admin/queues)
  // ========================================================
  describe('Bull Board Queue Administration Protection', () => {
    test('Unauthenticated request to /admin/queues receives 401 with WWW-Authenticate header', async () => {
      const res = await request({
        method: 'GET',
        path: '/admin/queues',
      });

      assert.equal(res.status, 401);
      assert.ok(res.headers['www-authenticate']?.includes('Basic realm="Bull Board Queue Administration"'));
      assert.ok(res.body?.error?.includes('Authentication required'));
    });

    test('Authenticated request by non-admin user receives 403 Forbidden', async () => {
      // Mock session for a regular user NOT in config.admin.emails
      authService.validateSession = async (token: string) => {
        if (token === 'regular-user-token') {
          return {
            id: '11111111-1111-1111-1111-111111111111',
            email: 'regular.bob@external.io',
            name: 'Regular Bob',
          };
        }
        return null;
      };

      const res = await request({
        method: 'GET',
        path: '/admin/queues',
        headers: {
          Cookie: 'reachinbox_session=regular-user-token',
        },
      });

      assert.equal(res.status, 403);
      assert.ok(res.body?.error?.includes('Forbidden: You do not have administrator permissions'));
    });

    test('Authenticated request by authorized admin in allowlist accesses Bull Board', async () => {
      // Mock session for Oliver Brown (in config.admin.emails)
      authService.validateSession = async (token: string) => {
        if (token === 'admin-session-token') {
          return {
            id: DEFAULT_USER_ID,
            email: 'oliver.brown@domain.io',
            name: 'Oliver Brown',
          };
        }
        return null;
      };

      const res = await request({
        method: 'GET',
        path: '/admin/queues',
        headers: {
          Cookie: 'reachinbox_session=admin-session-token',
        },
      });

      // Bull Board responds with 200, 301 or 302 (redirecting to /admin/queues/)
      assert.ok([200, 301, 302, 304].includes(res.status));
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });

    test('HTTP Basic Auth with valid admin credentials accesses Bull Board', async () => {
      const basicAuthHeader = 'Basic ' + Buffer.from('testadmin:supersecretadminpass123').toString('base64');
      const res = await request({
        method: 'GET',
        path: '/admin/queues',
        headers: {
          Authorization: basicAuthHeader,
        },
      });

      assert.ok([200, 301, 302, 304].includes(res.status));
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });

    test('Admin API Token header (x-admin-key) accesses Bull Board', async () => {
      const res = await request({
        method: 'GET',
        path: '/admin/queues',
        headers: {
          'x-admin-key': 'adminkey_secure_999',
        },
      });

      assert.ok([200, 301, 302, 304].includes(res.status));
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });
  });

  // ========================================================
  // 2. Senders API Protection Tests (/api/senders)
  // ========================================================
  describe('Senders API Authentication & Tenant Isolation', () => {
    test('Unauthenticated GET /api/senders returns 401', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/senders',
      });

      assert.equal(res.status, 401);
      assert.ok(res.body?.error?.includes('Authentication required'));
    });

    test('Unauthenticated POST /api/senders returns 401', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/senders',
        body: {
          email: 'unauth@example.com',
          name: 'Unauth Sender',
        },
      });

      assert.equal(res.status, 401);
      assert.ok(res.body?.error?.includes('Authentication required'));
    });

    test('Authenticated user lists only their own scoped senders', async () => {
      const userAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      authService.validateSession = async (token: string) => {
        if (token === 'user-a-token') {
          return { id: userAId, email: 'alice@domain.io', name: 'Alice' };
        }
        return null;
      };

      let passedUserIdToList: string | undefined;
      emailRepository.listSenders = async (userId?: string) => {
        passedUserIdToList = userId;
        return [
          {
            id: 'sender-1',
            userId: userAId,
            email: 'alice.sales@domain.io',
            name: 'Alice Sales',
            hourlyLimit: 100,
            minDelaySeconds: 2,
          },
        ];
      };

      const res = await request({
        method: 'GET',
        path: '/api/senders',
        headers: {
          Cookie: 'reachinbox_session=user-a-token',
        },
      });

      assert.equal(res.status, 200);
      assert.equal(passedUserIdToList, userAId);
      assert.equal(res.body?.data?.length, 1);
      assert.equal(res.body?.data[0]?.email, 'alice.sales@domain.io');
    });

    test('Authenticated user creates a sender scoped to their account', async () => {
      const userAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      authService.validateSession = async (token: string) => {
        if (token === 'user-a-token') {
          return { id: userAId, email: 'alice@domain.io', name: 'Alice' };
        }
        return null;
      };

      let capturedInput: any = null;
      emailRepository.getSenderByEmail = async () => null; // not taken
      emailRepository.createSender = async (input: any) => {
        capturedInput = input;
        return {
          id: 'new-sender-id',
          userId: input.userId,
          email: input.email,
          name: input.name,
          hourlyLimit: input.hourlyLimit,
          minDelaySeconds: input.minDelaySeconds,
        };
      };

      const res = await request({
        method: 'POST',
        path: '/api/senders',
        headers: {
          Cookie: 'reachinbox_session=user-a-token',
        },
        body: {
          email: 'alice.outreach@domain.io',
          name: 'Alice Outreach',
          hourlyLimit: 150,
          minDelaySeconds: 5,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(capturedInput?.userId, userAId);
      assert.equal(capturedInput?.email, 'alice.outreach@domain.io');
      assert.equal(capturedInput?.hourlyLimit, 150);
      assert.equal(capturedInput?.minDelaySeconds, 5);
    });

    test('Multi-tenant isolation: User B cannot register or hijack User A sender email', async () => {
      const userAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const userBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      authService.validateSession = async (token: string) => {
        if (token === 'user-b-token') {
          return { id: userBId, email: 'bob@domain.io', name: 'Bob' };
        }
        return null;
      };

      // Mock getSenderByEmail returning a sender owned by User A
      emailRepository.getSenderByEmail = async (email: string) => {
        if (email === 'alice.sales@domain.io') {
          return {
            id: 'sender-1',
            userId: userAId, // Owned by Alice!
            email: 'alice.sales@domain.io',
            name: 'Alice Sales',
            hourlyLimit: 100,
            minDelaySeconds: 2,
          };
        }
        return null;
      };

      const res = await request({
        method: 'POST',
        path: '/api/senders',
        headers: {
          Cookie: 'reachinbox_session=user-b-token',
        },
        body: {
          email: 'alice.sales@domain.io',
          name: 'Bob Impersonating Alice',
        },
      });

      assert.equal(res.status, 409);
      assert.ok(res.body?.error?.includes('already registered by another account'));
    });

    test('Demo-user isolation: Demo user session is scoped to DEFAULT_USER_ID', async () => {
      authService.validateSession = async (token: string) => {
        if (token === 'demo-session-token') {
          return { id: DEFAULT_USER_ID, email: 'oliver.brown@domain.io', name: 'Oliver Brown' };
        }
        return null;
      };

      let passedUserId: string | undefined;
      emailRepository.listSenders = async (userId?: string) => {
        passedUserId = userId;
        return [
          {
            id: 'demo-sender-1',
            userId: DEFAULT_USER_ID,
            email: 'oliver.brown@domain.io',
            name: 'Oliver Brown',
            hourlyLimit: 200,
            minDelaySeconds: 2,
          },
        ];
      };

      const res = await request({
        method: 'GET',
        path: '/api/senders',
        headers: {
          Cookie: 'reachinbox_session=demo-session-token',
        },
      });

      assert.equal(res.status, 200);
      assert.equal(passedUserId, DEFAULT_USER_ID);
      assert.equal(res.body?.data[0]?.userId, DEFAULT_USER_ID);
    });
  });

  // ========================================================
  // 3. OAuth Callback Redirects & Open Redirect Prevention
  // ========================================================
  describe('OAuth Callback Redirect Safety', () => {
    test('Google OAuth callback error redirects to config.clientUrl with sanitized error query', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/auth/google/callback?error=access_denied',
      });

      assert.equal(res.status, 302);
      const location = res.headers.location as string;
      assert.ok(location, 'Expected 302 Location header');
      const expectedOrigin = new URL(config.clientUrl).origin;
      assert.ok(location.startsWith(expectedOrigin), `Location ${location} must start with ${expectedOrigin}`);
      assert.ok(location.includes('auth_error=google_access_denied'));
      assert.ok(!location.includes('access_denied='), 'Raw error string must not be leaked');
    });

    test('Google OAuth callback missing state redirects to config.clientUrl', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/auth/google/callback?code=mock_code',
      });

      assert.equal(res.status, 302);
      const location = res.headers.location as string;
      const expectedOrigin = new URL(config.clientUrl).origin;
      assert.ok(location.startsWith(expectedOrigin));
      assert.ok(location.includes('auth_error=missing_code_or_state'));
    });

    test('Slack OAuth callback error redirects to config.clientUrl with sanitized error query', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/slack/callback?error=access_denied',
      });

      assert.equal(res.status, 302);
      const location = res.headers.location as string;
      assert.ok(location, 'Expected 302 Location header');
      const expectedOrigin = new URL(config.clientUrl).origin;
      assert.ok(location.startsWith(expectedOrigin), `Location ${location} must start with ${expectedOrigin}`);
      assert.ok(location.includes('slack_error=slack_access_denied'));
    });

    test('Slack OAuth callback missing state redirects to config.clientUrl', async () => {
      const res = await request({
        method: 'GET',
        path: '/api/slack/callback?code=mock_code',
      });

      assert.equal(res.status, 302);
      const location = res.headers.location as string;
      const expectedOrigin = new URL(config.clientUrl).origin;
      assert.ok(location.startsWith(expectedOrigin));
      assert.ok(location.includes('slack_error=missing_code_or_state'));
    });
  });

  // ========================================================
  // 4. Production Security Key & Secret Enforcement
  // ========================================================
  describe('Security Configuration Hardening', () => {
    test('Production rejects missing or default ENCRYPTION_KEY', async () => {
      const { validateSecurityConfig } = await import('../src/config/index.js');
      assert.throws(
        () => validateSecurityConfig('production', undefined, 'valid-session-secret-longer-than-32-chars!'),
        /ENCRYPTION_KEY is required in production/
      );
    });

    test('Production rejects short ENCRYPTION_KEY under 32 bytes', async () => {
      const { validateSecurityConfig } = await import('../src/config/index.js');
      assert.throws(
        () => validateSecurityConfig('production', 'short-16-bytes!', 'valid-session-secret-longer-than-32-chars!'),
        /must be at least 32 bytes/
      );
    });

    test('Production rejects missing or short SESSION_SECRET', async () => {
      const { validateSecurityConfig } = await import('../src/config/index.js');
      const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      assert.throws(
        () => validateSecurityConfig('production', validKey, 'short-secret'),
        /SESSION_SECRET in production must be at least 32 characters/
      );
    });

    test('Production accepts valid 32-byte (64-hex) encryption key and 32+ char session secret', async () => {
      const { validateSecurityConfig } = await import('../src/config/index.js');
      const validHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const validSecret = 'super-strong-production-session-secret-key-64-characters-long!';
      const resolved = validateSecurityConfig('production', validHexKey, validSecret);
      assert.equal(resolved.encryptionKey, validHexKey);
      assert.equal(resolved.sessionSecret, validSecret);
    });

    test('Development allows default keys with fallback notice', async () => {
      const { validateSecurityConfig } = await import('../src/config/index.js');
      const resolved = validateSecurityConfig('development', undefined, undefined);
      assert.ok(resolved.encryptionKey);
      assert.ok(resolved.sessionSecret);
    });
  });

  // ========================================================
  // 5. Mailer Transport Selection & Production Fallback Prevention
  // ========================================================
  describe('Mailer Transport Separation & Production Guard', () => {
    test('getTransportType correctly distinguishes ethereal vs smtp', async () => {
      const { mailerService } = await import('../src/services/mailer.service.js');
      const origUser = config.smtp.user;
      const origPass = config.smtp.pass;
      const origHost = config.smtp.host;

      try {
        config.smtp.user = undefined;
        config.smtp.pass = undefined;
        assert.equal(mailerService.getTransportType(), 'ethereal');

        config.smtp.user = 'real-user@domain.io';
        config.smtp.pass = 'real-password';
        config.smtp.host = 'smtp.gmail.com';
        assert.equal(mailerService.getTransportType(), 'smtp');
      } finally {
        config.smtp.user = origUser;
        config.smtp.pass = origPass;
        config.smtp.host = origHost;
      }
    });

    test('Production throws error if SMTP credentials are missing and rejects Ethereal fallback', async () => {
      const { mailerService } = await import('../src/services/mailer.service.js');
      const origEnv = config.env;
      const origUser = config.smtp.user;
      const origPass = config.smtp.pass;

      try {
        (config as any).env = 'production';
        config.smtp.user = undefined;
        config.smtp.pass = undefined;
        mailerService.resetTransporter();

        await assert.rejects(
          async () => mailerService.getTransporter(),
          /Production SMTP credentials are missing/
        );
      } finally {
        (config as any).env = origEnv;
        config.smtp.user = origUser;
        config.smtp.pass = origPass;
        mailerService.resetTransporter();
      }
    });
  });
});
