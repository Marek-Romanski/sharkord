import type { TFile, TPluginStorageUsage } from '@sharkord/shared';
import { and, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import { db } from '..';
import { attachFileToken } from '../../helpers/files-crypto';
import { files, messageFiles, messageReactions, messages } from '../schema';
import { getChannelsForUser } from './channels';
import { getSettings } from './server';

const getExceedingOldFiles = async (newFileSize: number) => {
  const { storageQuota, storageUploadMaxFileSize } = await getSettings();

  if (newFileSize > storageUploadMaxFileSize) {
    throw new Error('File size exceeds the maximum allowed file size');
  }

  const currentUsage = await db
    .select({
      totalSize: sum(files.size)
    })
    .from(files)
    .get();

  const currentTotalSize = Number(currentUsage?.totalSize ?? 0);
  const wouldExceedBy = currentTotalSize + newFileSize - storageQuota;

  if (wouldExceedBy <= 0) {
    return [];
  }

  const oldFiles = await db.all<{
    id: number;
    name: string;
    size: number;
    userId: number;
    createdAt: number;
  }>(sql`
    SELECT f.id, f.name, f.size, f.user_id AS userId, f.created_at AS createdAt
    FROM files f
    WHERE EXISTS (
      SELECT 1 FROM message_files mf WHERE mf.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.avatar_id = f.id OR u.banner_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM emojis e WHERE e.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM message_reactions mr WHERE mr.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM settings s WHERE s.logo_id = f.id
    )
    ORDER BY f.created_at ASC
  `);

  const filesToDelete = [];
  let freedSpace = 0;

  for (const file of oldFiles) {
    filesToDelete.push(file);
    freedSpace += file.size;

    if (freedSpace >= wouldExceedBy) {
      break;
    }
  }

  return filesToDelete;
};

const getFilesByMessageId = async (messageId: number): Promise<TFile[]> =>
  db
    .select()
    .from(messageFiles)
    .innerJoin(files, eq(messageFiles.fileId, files.id))
    .where(eq(messageFiles.messageId, messageId))
    .all()
    .map((row) => row.files);

const getFilesByUserId = async (
  userId: number,
  limit: number
): Promise<TFile[]> => {
  const [result, settings] = await Promise.all([
    db
      .select({
        file: files
      })
      .from(files)
      .where(eq(files.userId, userId))
      .orderBy(desc(files.createdAt))
      .limit(limit),
    getSettings()
  ]);

  const results = result.map((r) =>
    attachFileToken(
      r.file,
      settings.storageSignedUrlsEnabled,
      settings.storageSignedUrlsTtlSeconds
    )
  );

  return results;
};

// files a user may be handed a token for: server wide files (avatars, banners, emojis, the
// logo) and files attached to messages in channels the user can view
const getAccessibleFileIds = async (
  userId: number,
  fileIds: number[],
  directMessagesEnabled: boolean
): Promise<number[]> => {
  if (fileIds.length === 0) return [];

  const accessibleChannelIds = (await getChannelsForUser(userId))
    .filter((channel) => directMessagesEnabled || !channel.isDm)
    .map((channel) => channel.id);

  const [serverWideRows, attachedRows, reactionRows] = await Promise.all([
    db.all<{ id: number }>(sql`
      SELECT files.id
      FROM files
      WHERE ${inArray(files.id, fileIds)}
      AND (
        EXISTS (SELECT 1 FROM users u WHERE u.avatar_id = files.id OR u.banner_id = files.id)
        OR EXISTS (SELECT 1 FROM emojis e WHERE e.file_id = files.id)
        OR EXISTS (SELECT 1 FROM settings s WHERE s.logo_id = files.id)
      )
    `),
    accessibleChannelIds.length === 0
      ? []
      : db
          .select({ fileId: messageFiles.fileId })
          .from(messageFiles)
          .innerJoin(messages, eq(messages.id, messageFiles.messageId))
          .where(
            and(
              inArray(messageFiles.fileId, fileIds),
              inArray(messages.channelId, accessibleChannelIds)
            )
          )
          .all(),
    accessibleChannelIds.length === 0
      ? []
      : db
          .select({ fileId: messageReactions.fileId })
          .from(messageReactions)
          .innerJoin(messages, eq(messages.id, messageReactions.messageId))
          .where(
            and(
              inArray(messageReactions.fileId, fileIds),
              inArray(messages.channelId, accessibleChannelIds)
            )
          )
          .all()
  ]);

  const accessibleIds = new Set<number>([
    ...serverWideRows.map((row) => row.id),
    ...attachedRows.map((row) => row.fileId),
    ...reactionRows.flatMap((row) => (row.fileId === null ? [] : [row.fileId]))
  ]);

  return Array.from(accessibleIds);
};

const getUsedFileQuota = async (): Promise<number> => {
  const result = await db
    .select({
      usedSpace: sum(files.size)
    })
    .from(files)
    .get();

  return Number(result?.usedSpace ?? 0);
};

const ORPHAN_GRACE_MS = 15 * 60 * 1000; // 15 minutes
const ORPHAN_BATCH_SIZE = 500;

const getStorageUsageByPlugin = async (): Promise<TPluginStorageUsage[]> => {
  const rows = await db.all<{
    pluginId: string;
    fileCount: number;
    usedSpace: number;
    installed: number;
  }>(sql`
    SELECT
      f.plugin_id AS pluginId,
      COUNT(*) AS fileCount,
      COALESCE(SUM(f.size), 0) AS usedSpace,
      EXISTS (
        SELECT 1 FROM plugin_data pd WHERE pd.plugin_id = f.plugin_id
      ) AS installed
    FROM files f
    WHERE f.plugin_id IS NOT NULL
    GROUP BY f.plugin_id
    ORDER BY usedSpace DESC
  `);

  return rows.map((row) => ({
    pluginId: row.pluginId,
    fileCount: row.fileCount,
    usedSpace: row.usedSpace,
    installed: !!row.installed
  }));
};

const getOrphanedFileIds = async (): Promise<number[]> => {
  const orphanedFileIds = await db.all<{ id: number }>(sql`
    SELECT f.id
    FROM files f
    WHERE f.created_at < ${Date.now() - ORPHAN_GRACE_MS}
    AND NOT EXISTS (
      SELECT 1 FROM message_files mf WHERE mf.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.avatar_id = f.id OR u.banner_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM emojis e WHERE e.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM message_reactions mr WHERE mr.file_id = f.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM settings s WHERE s.logo_id = f.id
    )
    LIMIT ${ORPHAN_BATCH_SIZE}
  `);

  return orphanedFileIds.map(({ id }) => id);
};

const isFileOrphaned = async (fileId: number): Promise<boolean> => {
  const result = await db.get(sql`
    SELECT 
      CASE 
        WHEN NOT EXISTS (SELECT 1 FROM message_files mf WHERE mf.file_id = ${fileId})
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_id = ${fileId} OR u.banner_id = ${fileId})
        AND NOT EXISTS (SELECT 1 FROM emojis e WHERE e.file_id = ${fileId})
        AND NOT EXISTS (SELECT 1 FROM message_reactions mr WHERE mr.file_id = ${fileId})
        AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.logo_id = ${fileId})
        THEN 1
        ELSE 0
      END as isOrphaned
  `);

  const isOrphaned = Array.isArray(result) ? result[0] === 1 : false;

  return isOrphaned;
};

export {
  getAccessibleFileIds,
  getExceedingOldFiles,
  getFilesByMessageId,
  getFilesByUserId,
  getOrphanedFileIds,
  getStorageUsageByPlugin,
  getUsedFileQuota,
  isFileOrphaned
};
