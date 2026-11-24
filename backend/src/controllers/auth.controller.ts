import crypto from 'crypto';
import type { Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { emailRepository } from '../models/email.repository.js';
import { extractSessionToken, SESSION_COOKIE_NAME } from '../middleware/auth.middleware.js';
import { config } from '../config/index.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

/**
 * POST /api/auth/login
 * Email + password authentication (supports Figma "or sign up through email").
 */
export const login = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await emailRepository.getUserByEmail(String(email).trim().toLowerCase());
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = authService.verifyPassword(String(password), user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { token, expiresAt } = await authService.createSessionForUser(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    res.cookie(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS);

    return res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      token,
      expiresAt,
    });
  } catch (err: any) {
    console.error('[AuthController] Login error:', err.message);
    return res.status(500).json({ error: 'Internal login error', details: err.message });
  }
};

/**
 * POST /api/auth/signup
 * New user registration with email and password.
 */
export const signup = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await emailRepository.getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = authService.hashPassword(String(password));
    const user = await emailRepository.createUser({
      email: normalizedEmail,
      name: name ? String(name).trim() : normalizedEmail.split('@')[0],
      passwordHash,
    });

    const { token, expiresAt } = await authService.createSessionForUser(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    res.cookie(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS);

    return res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      token,
      expiresAt,
    });
  } catch (err: any) {
    console.error('[AuthController] Signup error:', err.message);
    return res.status(500).json({ error: 'Internal signup error', details: err.message });
  }
};

/**
 * POST /api/auth/demo
 * 1-click Demo Login as Oliver Brown (Figma design user profile).
 * Essential for testing & reviewer evaluation without Google OAuth keys.
 */
export const demoLogin = async (req: Request, res: Response): Promise<Response> => {
  try {
    const user = await authService.getDemoUser();
    const { token, expiresAt } = await authService.createSessionForUser(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    res.cookie(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS);

    return res.status(200).json({
      message: 'Authenticated as demo user Oliver Brown',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      token,
      expiresAt,
    });
  } catch (err: any) {
    console.error('[AuthController] Demo login error:', err.message);
    return res.status(500).json({ error: 'Failed to authenticate demo user', details: err.message });
  }
};

/**
 * GET /api/auth/me
 * Returns current authenticated user profile.
 */
export const getCurrentUser = async (req: Request, res: Response): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.status(200).json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      avatarUrl: req.user.avatarUrl,
    },
  });
};

/**
 * POST /api/auth/logout
 * Destroys session and clears cookie.
 */
export const logout = async (req: Request, res: Response): Promise<Response> => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await authService.invalidateSession(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to log out', details: err.message });
  }
};

/**
 * Helper to build safe absolute redirect URLs pointing to the frontend clientUrl.
 * Prevents open redirect attacks by ensuring paths are relative to config.clientUrl.
 */
const buildClientRedirectUrl = (path: string, queryParams?: Record<string, string>): string => {
  const base = config.clientUrl.endsWith('/') ? config.clientUrl : `${config.clientUrl}/`;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(cleanPath, base);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
};

/**
 * Validates a redirect target path to prevent open redirect vulnerabilities.
 * Allows only safe relative paths (e.g. '/scheduled', '/compose').
 */
const getSafeRedirectPath = (target?: string | null): string => {
  if (!target || typeof target !== 'string') return '/';
  const trimmed = target.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) {
    return trimmed;
  }
  return '/';
};

/**
 * GET /api/auth/google
 * Initiates Google OAuth 2.0 flow.
 */
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  if (!config.google.clientId || !config.google.clientSecret) {
    if (req.headers.accept?.includes('text/html')) {
      res.redirect(buildClientRedirectUrl('/', { auth_error: 'google_not_configured' }));
      return;
    }
    res.status(501).json({
      error: 'Google OAuth is not configured on this server. Please use demo login or set GOOGLE_CLIENT_ID.',
    });
    return;
  }

  const state = crypto.randomUUID();
  const safeRedirect = getSafeRedirectPath(req.query.redirect as string);
  await emailRepository.saveOAuthState(state, 'google', safeRedirect);
  const url = authService.getGoogleAuthUrl(state);
  res.redirect(url);
};

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth redirect callback.
 */
export const googleCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      console.warn('[AuthController] Google OAuth returned error:', error);
      res.redirect(buildClientRedirectUrl('/', { auth_error: 'google_access_denied' }));
      return;
    }

    if (!code || !state) {
      res.redirect(buildClientRedirectUrl('/', { auth_error: 'missing_code_or_state' }));
      return;
    }

    const stateRecord = await emailRepository.verifyAndConsumeOAuthState(String(state), 'google');
    if (!stateRecord.valid) {
      res.redirect(buildClientRedirectUrl('/', { auth_error: 'invalid_or_expired_state' }));
      return;
    }

    const profile = await authService.exchangeGoogleCode(String(code));
    let user = await emailRepository.getUserByGoogleId(profile.googleId);

    if (!user) {
      user = await emailRepository.getUserByEmail(profile.email);
    }

    if (!user) {
      user = await emailRepository.createUser({
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl,
      });
    }

    const { token } = await authService.createSessionForUser(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    res.cookie(SESSION_COOKIE_NAME, token, COOKIE_OPTIONS);
    const targetPath = getSafeRedirectPath(stateRecord.redirectUrl);
    res.redirect(buildClientRedirectUrl(targetPath));
  } catch (err: any) {
    console.error('[AuthController] Google callback error:', err.message);
    res.redirect(buildClientRedirectUrl('/', { auth_error: 'oauth_failed' }));
  }
};

export const authController = {
  login,
  signup,
  demoLogin,
  getCurrentUser,
  logout,
  googleAuth,
  googleCallback,
};

export default authController;
