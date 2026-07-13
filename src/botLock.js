import mongoose from 'mongoose';
import crypto from 'crypto';

const BOT_LOCK_ID = 'whatsapp_bot_lock';
const BOT_LOCK_TTL_MS = 30_000;

const botLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    instanceId: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'whatsapp_bot_lock' }
);

const BotLock = mongoose.models.BotLock || mongoose.model('BotLock', botLockSchema);

export function createBotInstanceId() {
  return crypto.randomUUID();
}

export async function acquireBotLock(instanceId) {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - BOT_LOCK_TTL_MS);

  const lock = await BotLock.findOneAndUpdate(
    {
      _id: BOT_LOCK_ID,
      $or: [{ updatedAt: { $lt: staleThreshold } }, { instanceId }],
    },
    { instanceId, updatedAt: now },
    { new: true }
  );

  if (lock) {
    return lock.instanceId === instanceId;
  }

  try {
    await BotLock.create({ _id: BOT_LOCK_ID, instanceId, updatedAt: now });
    return true;
  } catch (error) {
    if (error.code === 11000) {
      return false;
    }
    throw error;
  }
}

export async function refreshBotLock(instanceId) {
  const now = new Date();
  const lock = await BotLock.findOneAndUpdate(
    { _id: BOT_LOCK_ID, instanceId },
    { updatedAt: now },
    { new: true }
  );
  return !!lock;
}

export async function releaseBotLock(instanceId) {
  await BotLock.deleteOne({ _id: BOT_LOCK_ID, instanceId });
}
