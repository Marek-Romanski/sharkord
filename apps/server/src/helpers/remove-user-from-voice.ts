import { ServerEvents } from '@sharkord/shared';
import { unpublishHiddenChannelFromUser } from '../db/publishers';
import { VoiceRuntime } from '../runtimes/voice';
import { pubsub } from '../utils/pubsub';
import { clearVoiceSessionOwner } from './voice-session-owners';

const removeUserFromVoice = async (userId: number) => {
  clearVoiceSessionOwner(userId);

  const runtime = VoiceRuntime.findRuntimeByUserId(userId);

  if (!runtime) return;

  runtime.removeUser(userId);

  pubsub.publish(ServerEvents.USER_LEAVE_VOICE, {
    channelId: runtime.id,
    userId
  });

  await unpublishHiddenChannelFromUser(userId, runtime.id);
};

export { removeUserFromVoice };
