import { Redis } from 'ioredis';
import { createRedisConnection } from '../config/redis.js';
import type { RateLimitReservation } from '../types/index.js';

/**
 * Unified Atomic Redis Lua Script for Multi-Sender Rate Limiting & Pacing:
 *
 * KEYS[1]: Last physical dispatch slot key: 'rl:pacing:{sender}'
 * KEYS[2]: Hourly quota counter prefix: 'rl:quota:{sender}'
 * ARGV[1]: hourlyLimit (integer number of emails allowed per hour)
 * ARGV[2]: minDelayMs (integer minimum spacing between consecutive dispatches)
 * ARGV[3]: nowMsOverride (optional override for testing, > 0)
 * ARGV[4]: emailId (optional UUID of email for strictly idempotent retry reservation)
 *
 * Guarantees:
 * 1. Authoritative server wall-clock time via Redis TIME (synchronized Redis server time, not monotonic).
 * 2. Distributed pacing: candidate physical dispatch slot = max(nowMs, lastSlot + minDelayMs).
 * 3. UTC Hour Alignment: target UTC hour = floor(candidateSlot / 3600000).
 * 4. Zero cross-window quota leakage: checks and increments quota in the actual hour the email physically dispatches.
 * 5. Deterministic rescheduling: if quota is exhausted, returns allowed = 0 and nextHourStartMs = (candidateHour + 1) * 3600000.
 * 6. Idempotent Retry Quota Reservation: an email that retries within the same hour window does NOT consume multiple quota units.
 */
const RATE_LIMIT_PACING_LUA = `
local nowMs
if ARGV[3] and tonumber(ARGV[3]) > 0 then
  nowMs = tonumber(ARGV[3])
else
  local t = redis.call('TIME')
  nowMs = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
end

local hourlyLimit = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local emailId = ARGV[4]

-- 1. Read last reserved dispatch slot
local lastSlotStr = redis.call('GET', KEYS[1])
local lastSlot = lastSlotStr and tonumber(lastSlotStr) or 0

-- 2. Compute candidate physical dispatch slot ensuring minimum inter-send spacing
local candidateSlot = math.max(nowMs, lastSlot + minDelayMs)

-- 3. Determine target UTC hour window for this candidate slot
local hourMs = 3600000
local candidateHour = math.floor(candidateSlot / hourMs)
local nextHourStartMs = (candidateHour + 1) * hourMs

-- 4. Check whether this specific email already holds an active quota reservation in this hour window
local hourKey = KEYS[2] .. ':' .. candidateHour
local emailSetKey = KEYS[2] .. ':' .. candidateHour .. ':emails'

local alreadyReserved = 0
if emailId and string.len(emailId) > 0 then
  alreadyReserved = redis.call('SISMEMBER', emailSetKey, emailId)
end

local currentCount = tonumber(redis.call('GET', hourKey) or '0')

if alreadyReserved == 1 then
  -- Email already reserved quota in this window (e.g. SMTP retry or crashed worker recovery).
  -- Do NOT increment the hourly counter again. Update pacing slot.
  redis.call('SET', KEYS[1], candidateSlot, 'EX', 7200)
  local sleepMs = math.max(0, candidateSlot - nowMs)
  return { 1, candidateSlot, sleepMs, nextHourStartMs, currentCount, hourlyLimit }
end

if currentCount >= hourlyLimit then
  -- Limit reached: do NOT reserve pacing slot; return next hour start
  local sleepMs = math.max(0, nextHourStartMs - nowMs)
  return { 0, candidateSlot, sleepMs, nextHourStartMs, currentCount, hourlyLimit }
end

-- 5. Quota available: atomically record reservation and increment hourly count
local newCount = redis.call('INCR', hourKey)
if newCount == 1 then
  redis.call('EXPIRE', hourKey, 7200)
end

if emailId and string.len(emailId) > 0 then
  redis.call('SADD', emailSetKey, emailId)
  redis.call('EXPIRE', emailSetKey, 7200)
end

-- Update pacing slot
redis.call('SET', KEYS[1], candidateSlot, 'EX', 7200)

local sleepMs = math.max(0, candidateSlot - nowMs)
return { 1, candidateSlot, sleepMs, nextHourStartMs, newCount, hourlyLimit }
`;

let redisClient: Redis | null = null;

export const getRateLimitRedis = (): Redis => {
  if (!redisClient) {
    redisClient = createRedisConnection(false);
  }
  return redisClient;
};

export const setRateLimitRedis = (client: Redis | null): void => {
  redisClient = client;
};

/**
 * Atomically reserves a physical send slot and hourly quota for a given sender.
 *
 * @param senderEmail - Email address of sender
 * @param hourlyLimit - Max allowed sends in the target UTC hour
 * @param minDelaySeconds - Minimum delay between emails in seconds
 * @param emailId - Optional UUID of email for idempotent retry reservations
 * @param nowMsOverride - Optional timestamp override for deterministic tests
 * @returns {Promise<RateLimitReservation>}
 */
export const reserveSendSlot = async (
  senderEmail: string,
  hourlyLimit: number,
  minDelaySeconds: number,
  emailId?: string,
  nowMsOverride?: number
): Promise<RateLimitReservation> => {
  const client = getRateLimitRedis();
  const normalizedSender = senderEmail.trim().toLowerCase();
  const pacingKey = `rl:pacing:${normalizedSender}`;
  const quotaKeyPrefix = `rl:quota:${normalizedSender}`;
  const minDelayMs = Math.max(0, Math.floor(minDelaySeconds * 1000));

  const result = (await client.eval(
    RATE_LIMIT_PACING_LUA,
    2,
    pacingKey,
    quotaKeyPrefix,
    hourlyLimit,
    minDelayMs,
    nowMsOverride && nowMsOverride > 0 ? nowMsOverride : 0,
    emailId ? emailId.trim() : ''
  )) as [number, number, number, number, number, number];

  const [allowedRaw, dispatchSlot, sleepMs, nextHourStartMs, currentCount, limit] = result;

  return {
    allowed: allowedRaw === 1,
    dispatchSlot: Number(dispatchSlot),
    sleepMs: Number(sleepMs),
    nextHourStartMs: Number(nextHourStartMs),
    currentCount: Number(currentCount),
    hourlyLimit: Number(limit),
  };
};

/**
 * Resets all rate-limiting and pacing keys for a sender (primarily for tests).
 */
export const resetSenderLimits = async (senderEmail: string): Promise<void> => {
  const client = getRateLimitRedis();
  const normalizedSender = senderEmail.trim().toLowerCase();
  const keys = await client.keys(`rl:*:${normalizedSender}*`);
  if (keys.length > 0) {
    await client.del(...keys);
  }
};

/**
 * Gracefully closes the rate limiter Redis connection.
 */
export const closeRateLimiter = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
};

export const ratelimitService = {
  getRateLimitRedis,
  setRateLimitRedis,
  reserveSendSlot,
  resetSenderLimits,
  closeRateLimiter,
};

export default ratelimitService;
