import type { Request, Response } from 'express';
import { emailRepository } from '../models/email.repository.js';
import { slackService } from '../services/slack.service.js';
import { config } from '../config/index.js';

/**
 * GET /api/slack/status
 * Returns current Slack connection status.
 */
export const getSlackStatus = async (req: Request, res: Response): Promise<Response> => {
  try {
    const integration = await emailRepository.getSlackIntegration();
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
      channelName: integration?.channelName || 'default-channel',
      isEnvConfigured: hasEnvWebhook,
    });
  } catch (err: any) {
    console.error('[SlackController] Error fetching Slack status:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve Slack status', details: err.message });
  }
};

/**
 * POST /api/slack/webhook
 * Connects or updates a Slack incoming webhook.
 */
export const configureSlackWebhook = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { webhookUrl, channelName, teamName } = req.body;

    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({
        error: 'A valid Slack Incoming Webhook URL is required (must start with https://hooks.slack.com/)',
      });
    }

    const encryptedWebhook = slackService.encrypt(webhookUrl.trim());

    const integration = await emailRepository.saveSlackIntegration({
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
 * DELETE /api/slack
 * Disconnects the active Slack integration.
 */
export const disconnectSlack = async (req: Request, res: Response): Promise<Response> => {
  try {
    await emailRepository.deleteSlackIntegration();
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
  disconnectSlack,
};

export default slackController;
