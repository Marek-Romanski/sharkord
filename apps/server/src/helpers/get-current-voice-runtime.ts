import { Permission } from '@sharkord/shared';
import { VoiceRuntime } from '../runtimes/voice';
import { invariant } from '../utils/invariant';
import type { Context } from '../utils/trpc';
import { hasLostVoiceSession } from './voice-session-owners';

const getCurrentVoiceRuntime = async (ctx: Context) => {
  await ctx.needsPermission(Permission.JOIN_VOICE_CHANNELS);

  invariant(ctx.currentVoiceChannelId, {
    code: 'BAD_REQUEST',
    message: 'User is not in a voice channel'
  });

  // a connection that lost the session to a newer one must not act on it
  invariant(!hasLostVoiceSession(ctx.user.id, ctx.getOwnWs()), {
    code: 'BAD_REQUEST',
    message: 'User is not in a voice channel'
  });

  const runtime = VoiceRuntime.findById(ctx.currentVoiceChannelId);

  invariant(runtime, {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Voice runtime not found for this channel'
  });

  // the context outlives the session: a connection that was replaced and then left behind
  // would otherwise keep using the routes after the owner was cleared
  invariant(runtime.getUser(ctx.user.id), {
    code: 'BAD_REQUEST',
    message: 'User is not in a voice channel'
  });

  return { runtime, channelId: ctx.currentVoiceChannelId };
};

export { getCurrentVoiceRuntime };
