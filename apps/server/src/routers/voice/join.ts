import {
  ChannelPermission,
  ChannelType,
  Permission,
  ServerEvents,
  type TBeforeVoiceJoinPayload
} from '@sharkord/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../db';
import { channels } from '../../db/schema';
import { removeUserFromVoice } from '../../helpers/remove-user-from-voice';
import {
  consumeVoiceMoveGrant,
  hasVoiceMoveGrant
} from '../../helpers/voice-move-grants';
import {
  hasLostVoiceSession,
  setVoiceSessionOwner
} from '../../helpers/voice-session-owners';
import { logger } from '../../logger';
import { pluginManager } from '../../plugins';
import { runHook } from '../../plugins/run-hook';
import { VoiceRuntime } from '../../runtimes/voice';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const joinVoiceRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.joinVoiceChannel.maxRequests,
  windowMs: config.rateLimiters.joinVoiceChannel.windowMs,
  logLabel: 'joinVoice'
})
  .input(
    z.object({
      channelId: z.number(),
      state: z.object({
        micMuted: z.boolean().default(false),
        soundMuted: z.boolean().default(false)
      })
    })
  )
  .mutation(async ({ input, ctx }) => {
    await ctx.needsPermission(Permission.JOIN_VOICE_CHANNELS);

    const movedByModerator = hasVoiceMoveGrant(ctx.user.id, input.channelId);

    if (!movedByModerator) {
      await ctx.needsChannelPermission(input.channelId, ChannelPermission.JOIN);
    }

    const channel = await db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        isDm: channels.isDm
      })
      .from(channels)
      .where(eq(channels.id, input.channelId))
      .get();

    invariant(channel, {
      code: 'NOT_FOUND',
      message: 'Channel not found'
    });

    invariant(channel.type === ChannelType.VOICE, {
      code: 'BAD_REQUEST',
      message: 'Channel is not a voice channel'
    });

    invariant(!channel.isDm, {
      code: 'BAD_REQUEST',
      message: 'Cannot join a direct message channel as a voice channel'
    });

    const ownWs = ctx.getOwnWs();

    // the session belongs to another connection of this user. mostly an old one, the client
    // already reconnected after a network change but the old socket has not timed out yet.
    // it can also be a second open tab or device. either way the newest join wins, so take
    // the session over instead of refusing
    const isTakeover = hasLostVoiceSession(ctx.user.id, ownWs);

    const userAlreadyInVoiceChannel = VoiceRuntime.findRuntimeByUserId(
      ctx.user.id
    );

    invariant(!userAlreadyInVoiceChannel || isTakeover, {
      code: 'BAD_REQUEST',
      message: 'User already in a voice channel'
    });

    await runHook<TBeforeVoiceJoinPayload, never>({
      entries: pluginManager.getHooks('beforeVoiceJoin'),
      payload: {
        channelId: input.channelId,
        userId: ctx.user.id,
        movedByModerator
      }
    });

    const runtime = VoiceRuntime.findById(input.channelId);

    invariant(runtime, {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Voice runtime not found for this channel'
    });

    // before anything changes: a runtime without a router would leave the user in neither
    // the old session nor the new one
    const router = runtime.getRouter();

    if (isTakeover) await removeUserFromVoice(ctx.user.id);

    runtime.addUser(ctx.user.id, input.state);

    if (movedByModerator) consumeVoiceMoveGrant(ctx.user.id);

    const state = runtime.getUserState(ctx.user.id);

    ctx.currentVoiceChannelId = channel.id;

    if (ownWs) setVoiceSessionOwner(ctx.user.id, ownWs);

    ctx.pubsub.publish(ServerEvents.USER_JOIN_VOICE, {
      channelId: input.channelId,
      userId: ctx.user.id,
      state
    });

    logger.info('%s joined voice channel %s', ctx.user.name, channel.name);

    return {
      routerRtpCapabilities: router.rtpCapabilities
    };
  });

export { joinVoiceRoute };
