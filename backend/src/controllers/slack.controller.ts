import crypto from 'crypto';
import type { Request, Response } from 'express';
import { emailRepository, DEFAULT_USER_ID } from '../models/email.repository.js';
import { slackService } from '../services/slack.service.js';
import { config } from '../config/index.js';

/**
 * GET /api/slack/status
 * Returns current Slack connection status for the authenticated user.
 */
export const getSlackStatus = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.user?.id || DEFAULT_USER_ID;
    const integration = await emailRepository.getSlackIntegration(userId);
    const hasEnvWebhook = Boolean(config.slack.webhookUrl);

    if (!integration && !hasEnvWebhook) {
      return res.status(200).json({
        connected: false,
        message: 'No Slack integration configured',
      });
    }

    return res.status(200).json({
      connected: true,
      teamName: integration?.teamName || 'Workspace',
      channelName: integration?.channelName || '#general',
      isEnvConfigured: hasEnvWebhook,
    });
  } catch (err: any) {
    console.error('[SlackController] Error fetching Slack status:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve Slack status', details: err.message });
  }
};

/**
 * POST /api/slack/webhook
 * Connects or updates a Slack incoming webhook manually.
 */
export const configureSlackWebhook = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.user?.id || DEFAULT_USER_ID;
    const { webhookUrl, channelName, teamName } = req.body;

    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({
        error: 'A valid Slack Incoming Webhook URL is required (must start with https://hooks.slack.com/)',
      });
    }

    const encryptedWebhook = slackService.encrypt(webhookUrl.trim());

    const integration = await emailRepository.saveSlackIntegration({
      userId,
      webhookUrlEncrypted: encryptedWebhook,
      channelName: channelName ? String(channelName).trim() : '#general',
      teamName: teamName ? String(teamName).trim() : 'Slack Workspace',
    });

    return res.status(200).json({
      message: 'Slack webhook configured successfully',
      data: {
        teamName: integration.teamName,
        channelName: integration.channelName,
        connected: true,
      },
    });
  } catch (err: any) {
    console.error('[SlackController] Error configuring Slack webhook:', err.message);
    return res.status(500).json({ error: 'Failed to configure Slack webhook', details: err.message });
  }
};

/**
 * Helper to build safe absolute redirect URLs pointing to the frontend clientUrl.
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
 * GET /api/slack/oauth
 * Initiates Slack OAuth 2.0 flow for incoming webhook authorization.
 */
export const initiateSlackOAuth = async (req: Request, res: Response): Promise<void> => {
  if (!config.slack.clientId || !config.slack.clientSecret) {
    if (req.headers.accept?.includes('text/html')) {
      res.redirect(buildClientRedirectUrl('/', { slack_error: 'oauth_not_configured' }));
      return;
    }
    res.status(501).json({
      error: 'Slack OAuth is not configured on this server. Please use manual webhook setup or configure SLACK_CLIENT_ID.',
    });
    return;
  }

  const userId = req.user?.id || DEFAULT_USER_ID;
  const state = crypto.randomUUID();
  const safeRedirect = getSafeRedirectPath(req.query.redirect as string);
  await emailRepository.saveOAuthState(state, 'slack', safeRedirect, userId);

  const redirectUri = config.slack.redirectUri || `${req.protocol}://${req.get('host')}/api/slack/callback`;
  const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${config.slack.clientId}&scope=incoming-webhook&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`;

  res.redirect(slackUrl);
};

/**
 * GET /api/slack/callback
 * Handles OAuth callback from Slack, exchanges code for incoming-webhook token.
 */
export const handleSlackCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.warn('[SlackController] Slack OAuth returned error:', error);
      res.redirect(buildClientRedirectUrl('/', { slack_error: 'slack_access_denied' }));
      return;
    }

    if (!code || !state) {
      res.redirect(buildClientRedirectUrl('/', { slack_error: 'missing_code_or_state' }));
      return;
    }

    const stateRecord = await emailRepository.verifyAndConsumeOAuthState(String(state), 'slack');
    if (!stateRecord.valid) {
      res.redirect(buildClientRedirectUrl('/', { slack_error: 'invalid_or_expired_state' }));
      return;
    }

    const userId = stateRecord.userId || DEFAULT_USER_ID;
    const redirectUri = config.slack.redirectUri || `${req.protocol}://${req.get('host')}/api/slack/callback`;

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.slack.clientId,
        client_secret: config.slack.clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const data: any = await tokenRes.json();
    if (!data.ok) {
      throw new Error(data.error || 'Slack OAuth token exchange failed');
    }

    const webhookUrl = data.incoming_webhook?.url;
    const channelName = data.incoming_webhook?.channel || '#general';
    const teamName = data.team?.name || 'Slack Workspace';

    if (!webhookUrl) {
      throw new Error('Slack response did not contain an incoming webhook URL');
    }

    const encryptedWebhook = slackService.encrypt(webhookUrl);
    await emailRepository.saveSlackIntegration({
      userId,
      webhookUrlEncrypted: encryptedWebhook,
      channelName,
      teamName,
    });

    const targetPath = getSafeRedirectPath(stateRecord.redirectUrl);
    res.redirect(buildClientRedirectUrl(targetPath, { slack_connected: 'true' }));
  } catch (err: any) {
    console.error('[SlackController] Slack OAuth callback error:', err.message);
    res.redirect(buildClientRedirectUrl('/', { slack_error: 'oauth_failed' }));
  }
};

/**
 * DELETE /api/slack
 * Disconnects the active Slack integration for the authenticated user.
 */
export const disconnectSlack = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = req.user?.id || DEFAULT_USER_ID;
    await emailRepository.deleteSlackIntegration(userId);
    return res.status(200).json({
      message: 'Slack integration disconnected successfully',
      connected: false,
    });
  } catch (err: any) {
    console.error('[SlackController] Error disconnecting Slack:', err.message);
    return res.status(500).json({ error: 'Failed to disconnect Slack', details: err.message });
  }
};

export const slackController = {
  getSlackStatus,
  configureSlackWebhook,
  initiateSlackOAuth,
  handleSlackCallback,
  disconnectSlack,
};

export default slackController;
