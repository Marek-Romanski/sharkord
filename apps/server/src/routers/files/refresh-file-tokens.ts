import {
  STORAGE_MAX_FILE_TOKENS_PER_REFRESH,
  type TFileToken
} from '@sharkord/shared';
import { z } from 'zod';
import { config } from '../../config';
import { getAccessibleFileIds } from '../../db/queries/files';
import { getSettings } from '../../db/queries/server';
import { generateFileToken } from '../../helpers/files-crypto';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

// signed urls expire, so the client asks for new tokens before they do
const refreshFileTokensRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.refreshFileTokens.maxRequests,
  windowMs: config.rateLimiters.refreshFileTokens.windowMs,
  logLabel: 'refreshFileTokens'
})
  .input(
    z.object({
      fileIds: z
        .array(z.number().int())
        .max(STORAGE_MAX_FILE_TOKENS_PER_REFRESH)
    })
  )
  .query(async ({ ctx, input }): Promise<TFileToken[]> => {
    // no permission check: any member may refresh tokens, getAccessibleFileIds limits them
    // to files the caller can already see
    const {
      storageSignedUrlsEnabled,
      storageSignedUrlsTtlSeconds,
      directMessagesEnabled
    } = await getSettings();

    if (!storageSignedUrlsEnabled) return [];

    const accessibleFileIds = await getAccessibleFileIds(
      ctx.userId,
      input.fileIds,
      directMessagesEnabled
    );
    const expiresAt = Date.now() + storageSignedUrlsTtlSeconds * 1000;

    return accessibleFileIds.map((id) => ({
      id,
      _accessToken: generateFileToken(id, expiresAt),
      _accessTokenExpiresAt: expiresAt
    }));
  });

export { refreshFileTokensRoute };
