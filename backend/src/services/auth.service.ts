import crypto from 'crypto';
import { emailRepository, DEFAULT_USER_ID } from '../models/email.repository.js';
import type { UserRecord } from '../types/index.js';
import { config } from '../config/index.js';

const SESSION_EXPIRY_DAYS = 7;

/**
 * Hashes a plaintext password with salt using scrypt.
 */
export const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
};

/**
 * Verifies a plaintext password against a stored salt:hash string.
 */
export const verifyPassword = (password: string, storedHash: string): boolean => {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
};

/**
 * Creates a persistent stateful session for a user.
 */
export const createSessionForUser = async (
  userId: string,
  _userAgent?: string,
  _ipAddress?: string
): Promise<{ token: string; expiresAt: Date; user: UserRecord }> => {
  const user = await emailRepository.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await emailRepository.createSession(token, userId, expiresAt);

  return { token, expiresAt, user };
};

/**
 * Validates a session token and returns the authenticated user.
 */
export const validateSession = async (token: string): Promise<UserRecord | null> => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const sessionData = await emailRepository.getSession(token.trim());
  if (!sessionData) {
    return null;
  }

  if (new Date(sessionData.session.expiresAt).getTime() < Date.now()) {
    await emailRepository.deleteSession(sessionData.session.id);
    return null;
  }

  return sessionData.user;
};

/**
 * Terminates an active session.
 */
export const invalidateSession = async (token: string): Promise<void> => {
  if (!token) return;
  await emailRepository.deleteSession(token.trim());
};

/**
 * Builds Google OAuth 2.0 authorization URL.
 */
export const getGoogleAuthUrl = (state: string): string => {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: config.google.redirectUri,
    client_id: config.google.clientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    state,
  };

  const qs = new URLSearchParams(options);
  return `${rootUrl}?${qs.toString()}`;
};

/**
 * Exchanges Google authorization code for user profile information.
 */
export const exchangeGoogleCode = async (
  code: string
): Promise<{ googleId: string; email: string; name: string; avatarUrl?: string }> => {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const values = {
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: 'authorization_code',
  };

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  const tokenData: any = await res.json();
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error('Failed to fetch Google user profile');
  }

  const profile: any = await userRes.json();
  return {
    googleId: profile.sub,
    email: profile.email.toLowerCase(),
    name: profile.name || profile.email.split('@')[0],
    avatarUrl: profile.picture,
  };
};

/**
 * Retrieves the default demo user (Oliver Brown).
 */
export const getDemoUser = async (): Promise<UserRecord> => {
  let user = await emailRepository.getUserById(DEFAULT_USER_ID);
  if (!user) {
    user = await emailRepository.getUserByEmail('oliver.brown@domain.io');
  }
  if (!user) {
    user = await emailRepository.createUser({
      id: DEFAULT_USER_ID,
      email: 'oliver.brown@domain.io',
      name: 'Oliver Brown',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
    });
  }
  return user;
};

export const authService = {
  hashPassword,
  verifyPassword,
  createSessionForUser,
  validateSession,
  invalidateSession,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  getDemoUser,
};

export default authService;
