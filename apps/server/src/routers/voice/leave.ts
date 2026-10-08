import { ChannelType } from '@sharkord/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { channels } from '../../db/schema';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { removeUserFromVoice } from '../../helpers/remove-user-from-voice';
import { logger } from '../../logger';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const leaveVoiceRoute = protectedProcedure.mutation(async ({ ctx }) => {
  const { channelId } = await getCurrentVoiceRuntime(ctx);

  const channel = await db
    .select({
      id: channels.id,
      name: channels.name,
      type: channels.type
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .get();

  invariant(channel, {
    code: 'NOT_FOUND',
    message: 'Channel not found'
  });

  invariant(channel.type === ChannelType.VOICE, {
    code: 'BAD_REQUEST',
    message: 'Channel is not a voice channel'
  });

  await removeUserFromVoice(ctx.user.id);

  ctx.currentVoiceChannelId = undefined;

  logger.info('%s left voice channel %s', ctx.user.name, channel.name);
});

export { leaveVoiceRoute };
