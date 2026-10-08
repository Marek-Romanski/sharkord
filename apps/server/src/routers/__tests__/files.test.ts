import {
  STORAGE_MAX_FILE_TOKENS_PER_REFRESH,
  type TTempFile
} from '@sharkord/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import { initTest, login, uploadFile } from '../../__tests__/helpers';
import { tdb } from '../../__tests__/setup';
import { config } from '../../config';
import { emojis, messageReactions, settings, users } from '../../db/schema';
import { fileManager } from '../../helpers/file-manager';

describe('files router', () => {
  let tempFile: TTempFile;
  let counter = 0;

  beforeEach(async () => {
    const response = await login('testowner', 'password123');
    const data: any = await response.json();

    const res = await uploadFile(
      new File(['test'], `file-${counter++}.txt`, { type: 'text/plain' }),
      data.token
    );

    tempFile = (await res.json()) as TTempFile;
  });

  test('should clean up inline replies when removing the last file deletes the message', async () => {
    const { caller } = await initTest();

    // a file only message: removing its file removes the message itself
    const fileOnlyMessageId = await caller.messages.send({
      channelId: 1,
      content: '',
      files: [tempFile.id]
    });

    const replyId = await caller.messages.send({
      channelId: 1,
      content: 'Replying to the file message',
      files: [],
      replyToMessageId: fileOnlyMessageId
    });

    const message = await caller.messages.getOne({
      messageId: fileOnlyMessageId
    });

    expect(message.files.length).toBe(1);

    await caller.files.delete({ fileId: message.files[0]!.id });

    await expect(
      caller.messages.getOne({ messageId: fileOnlyMessageId })
    ).rejects.toThrow('Message not found');

    // the same cleanup messages.delete performs, this path used to skip it
    const reply = await caller.messages.getOne({ messageId: replyId });

    expect(reply.replyToMessageId).toBeNull();
    expect(reply.replyTo).toBeNull();
  });

  test('should update the parent reply count when a thread reply loses its last file', async () => {
    const { caller } = await initTest();

    const parentId = await caller.messages.send({
      channelId: 1,
      content: 'Thread parent',
      files: []
    });

    const threadReplyId = await caller.messages.send({
      channelId: 1,
      content: '',
      files: [tempFile.id],
      parentMessageId: parentId
    });

    const reply = await caller.messages.getOne({ messageId: threadReplyId });

    await caller.files.delete({ fileId: reply.files[0]!.id });

    const parent = await caller.messages.getOne({ messageId: parentId });

    expect(parent.replyCount).toBe(0);
  });

  test('should check temporary file existence', async () => {
    expect(tempFile).toBeDefined();
    expect(tempFile.id).toBeDefined();

    const file = await fileManager.getTemporaryFile(tempFile.id);

    expect(file).toBeDefined();
    expect(file?.path).toBe(tempFile.path);
    expect(file?.originalName).toBe(tempFile.originalName);
    expect(file?.size).toBe(tempFile.size);

    const stat = await fs.stat(tempFile.path);

    expect(stat.size).toBe(tempFile.size);
  });

  test('should delete a temporary file', async () => {
    const { caller } = await initTest();

    expect(await fs.exists(tempFile.path)).toBe(true);

    await caller.files.deleteTemporary({
      fileId: tempFile.id
    });

    expect(await fs.exists(tempFile.path)).toBe(false);
  });

  test('should throw when deleting a non-existent temporary file', async () => {
    const { caller } = await initTest();

    await expect(
      caller.files.deleteTemporary({
        fileId: '<non-existent-file-id>' // non-existent file ID
      })
    ).rejects.toThrow('Temporary file not found');
  });

  test('should throw when deleting other users temporary file', async () => {
    const { caller } = await initTest(2);

    await expect(
      caller.files.deleteTemporary({
        fileId: tempFile.id
      })
    ).rejects.toThrow(
      'You do not have permission to delete this temporary file'
    );

    expect(await fs.exists(tempFile.path)).toBe(true);
  });

  describe('refreshTokens', () => {
    // seeded channel 1 is public, channel 5 is restricted and user 2 is denied viewing it
    const PUBLIC_CHANNEL_ID = 1;
    const RESTRICTED_CHANNEL_ID = 5;

    const enableSignedUrls = () =>
      tdb.update(settings).set({
        storageSignedUrlsEnabled: true,
        storageSignedUrlsTtlSeconds: 3600
      });

    const sendFileTo = async (channelId: number) => {
      const { caller, mockedToken } = await initTest();

      const upload = await uploadFile(
        new File(['refresh'], `refresh-${counter++}.txt`, {
          type: 'text/plain'
        }),
        mockedToken
      );
      const uploaded = (await upload.json()) as TTempFile;

      const messageId = await caller.messages.send({
        channelId,
        content: 'with a file',
        files: [uploaded.id]
      });

      const message = await caller.messages.getOne({ messageId });

      return message.files[0]!.id;
    };

    test('should return fresh tokens for files the caller can see', async () => {
      await enableSignedUrls();

      const fileId = await sendFileTo(PUBLIC_CHANNEL_ID);
      const { caller } = await initTest(2);

      const before = Date.now();
      const tokens = await caller.files.refreshTokens({ fileIds: [fileId] });

      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.id).toBe(fileId);
      expect(tokens[0]!._accessToken).toBeString();
      expect(tokens[0]!._accessTokenExpiresAt).toBeGreaterThan(
        before + 3_000_000
      );
    });

    test('should not return tokens for files in channels the caller cannot view', async () => {
      await enableSignedUrls();

      const hiddenFileId = await sendFileTo(RESTRICTED_CHANNEL_ID);
      const visibleFileId = await sendFileTo(PUBLIC_CHANNEL_ID);

      const { caller: lowPermissionCaller } = await initTest(2);
      const { caller: admin } = await initTest(1);

      const asUser = await lowPermissionCaller.files.refreshTokens({
        fileIds: [hiddenFileId, visibleFileId]
      });

      expect(asUser.map((token) => token.id)).toEqual([visibleFileId]);

      const asAdmin = await admin.files.refreshTokens({
        fileIds: [hiddenFileId, visibleFileId]
      });

      expect(asAdmin.map((token) => token.id).sort()).toEqual(
        [hiddenFileId, visibleFileId].sort()
      );
    });

    test('should only return direct message files to the participants', async () => {
      await enableSignedUrls();
      await tdb
        .update(settings)
        .set({ storageFileSharingInDirectMessages: true });

      const { caller: admin } = await initTest(1);
      const { channelId } = await admin.dms.open({ userId: 2 });
      const dmFileId = await sendFileTo(channelId);

      const { caller: participant } = await initTest(2);
      const { caller: outsider } = await initTest(3);

      const asParticipant = await participant.files.refreshTokens({
        fileIds: [dmFileId]
      });

      expect(asParticipant.map((token) => token.id)).toEqual([dmFileId]);

      expect(
        await outsider.files.refreshTokens({ fileIds: [dmFileId] })
      ).toEqual([]);
    });

    test('should not return direct message files when direct messages are disabled', async () => {
      await enableSignedUrls();
      await tdb
        .update(settings)
        .set({ storageFileSharingInDirectMessages: true });

      const { caller: admin } = await initTest(1);
      const { channelId } = await admin.dms.open({ userId: 2 });
      const dmFileId = await sendFileTo(channelId);

      await tdb.update(settings).set({ directMessagesEnabled: false });

      const { caller: participant } = await initTest(2);

      expect(
        await participant.files.refreshTokens({ fileIds: [dmFileId] })
      ).toEqual([]);
    });

    test('should return tokens for banners, the logo, emojis and reaction files to any user', async () => {
      await enableSignedUrls();

      const { caller: admin, mockedToken } = await initTest(1);

      const uploadFileId = async (name: string) => {
        const upload = await uploadFile(
          new File([name], `${name}.png`, { type: 'image/png' }),
          mockedToken
        );

        return ((await upload.json()) as TTempFile).id;
      };

      await admin.users.changeBanner({ fileId: await uploadFileId('banner') });
      await admin.others.changeLogo({ fileId: await uploadFileId('logo') });
      await admin.emojis.add([
        { fileId: await uploadFileId('emoji'), name: 'token_emoji' }
      ]);

      const messageId = await admin.messages.send({
        channelId: PUBLIC_CHANNEL_ID,
        content: 'react to me',
        files: []
      });

      await admin.messages.toggleReaction({
        messageId,
        emoji: 'token_emoji'
      });

      const owner = await tdb
        .select({ bannerId: users.bannerId })
        .from(users)
        .where(eq(users.id, 1))
        .get();
      const server = await tdb
        .select({ logoId: settings.logoId })
        .from(settings)
        .get();
      const emoji = await tdb
        .select({ fileId: emojis.fileId })
        .from(emojis)
        .get();
      const reaction = await tdb
        .select({ fileId: messageReactions.fileId })
        .from(messageReactions)
        .get();

      const expectedIds = [
        owner!.bannerId!,
        server!.logoId!,
        emoji!.fileId,
        reaction!.fileId!
      ];

      const { caller } = await initTest(3);
      const tokens = await caller.files.refreshTokens({ fileIds: expectedIds });

      expect(tokens.map((token) => token.id).sort()).toEqual(
        Array.from(new Set(expectedIds)).sort()
      );
    });

    test('should return tokens for avatars to any user', async () => {
      await enableSignedUrls();

      const { caller: admin, mockedToken } = await initTest(1);

      const upload = await uploadFile(
        new File(['avatar'], 'avatar.png', { type: 'image/png' }),
        mockedToken
      );
      const uploaded = (await upload.json()) as TTempFile;

      await admin.users.changeAvatar({ fileId: uploaded.id });

      const owner = await tdb
        .select({ avatarId: users.avatarId })
        .from(users)
        .where(eq(users.id, 1))
        .get();

      const { caller } = await initTest(2);
      const tokens = await caller.files.refreshTokens({
        fileIds: [owner!.avatarId!]
      });

      expect(tokens.map((token) => token.id)).toEqual([owner!.avatarId!]);
    });

    test('should ignore ids that are not files', async () => {
      await enableSignedUrls();

      const { caller } = await initTest(2);

      expect(await caller.files.refreshTokens({ fileIds: [999999] })).toEqual(
        []
      );
    });

    test('should return nothing when signed urls are disabled', async () => {
      const fileId = await sendFileTo(PUBLIC_CHANNEL_ID);
      const { caller } = await initTest(2);

      expect(await caller.files.refreshTokens({ fileIds: [fileId] })).toEqual(
        []
      );
    });

    test('should rate limit excessive refreshes', async () => {
      const { caller } = await initTest(2);

      for (
        let i = 0;
        i < config.rateLimiters.refreshFileTokens.maxRequests;
        i++
      ) {
        await caller.files.refreshTokens({ fileIds: [] });
      }

      await expect(caller.files.refreshTokens({ fileIds: [] })).rejects.toThrow(
        'Too many requests. Please try again shortly.'
      );
    });

    test('should reject more ids than one refresh may carry', async () => {
      const { caller } = await initTest(2);

      await expect(
        caller.files.refreshTokens({
          fileIds: Array.from(
            { length: STORAGE_MAX_FILE_TOKENS_PER_REFRESH + 1 },
            (_, index) => index + 1
          )
        })
      ).rejects.toThrow('expected array to have <=200 items');
    });
  });
});
