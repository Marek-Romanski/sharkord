import type {
  TFile,
  TJoinedEmoji,
  TJoinedMessage,
  TJoinedPublicUser
} from '@sharkord/shared';
import { describe, expect, test } from 'bun:test';
import type { IServerState } from '../../slice';
import { applyFileTokens, getFilesToRefresh } from '../helpers';

const file = (id: number, expiresAt?: number) =>
  ({
    id,
    _accessToken: expiresAt === undefined ? undefined : `token-${id}`,
    _accessTokenExpiresAt: expiresAt
  }) as TFile;

const buildState = (): IServerState =>
  ({
    users: [
      { id: 1, avatar: file(1, 100), banner: file(2, 900) },
      { id: 2, avatar: null, banner: null }
    ] as TJoinedPublicUser[],
    emojis: [{ id: 1, file: file(3, 100) }] as TJoinedEmoji[],
    messagesMap: {
      10: [
        {
          id: 1,
          files: [file(4, 100), file(5)],
          reactions: [{ file: file(6, 100) }, { file: null }]
        }
      ] as unknown as TJoinedMessage[]
    },
    threadMessagesMap: {
      20: [
        { id: 2, files: [file(1, 100)], reactions: [] }
      ] as unknown as TJoinedMessage[]
    }
  }) as unknown as IServerState;

describe('getFilesToRefresh', () => {
  const idsOf = (state: IServerState, cutoff: number) =>
    getFilesToRefresh(state, cutoff)
      .map((file) => file.id)
      .sort();

  test('should collect every file expiring before the cutoff, once', () => {
    expect(idsOf(buildState(), 500)).toEqual([1, 3, 4, 5, 6]);
  });

  test('should skip files that expire later', () => {
    expect(idsOf(buildState(), 500)).not.toContain(2);
  });

  test('should collect files without a token, they were loaded before signed urls were on', () => {
    expect(idsOf(buildState(), 500)).toContain(5);
  });

  test('should report the earliest expiry of a file held in several places', () => {
    const state = buildState();

    state.users[0]!.avatar!._accessTokenExpiresAt = 300;

    expect(getFilesToRefresh(state, 500)).toContainEqual({
      id: 1,
      expiresAt: 100
    });
  });

  test('should only return files without a token when none is close to expiry', () => {
    expect(idsOf(buildState(), 50)).toEqual([5]);
  });
});

describe('applyFileTokens', () => {
  const fresh = [
    { id: 1, _accessToken: 'new-1', _accessTokenExpiresAt: 5000 },
    { id: 4, _accessToken: 'new-4', _accessTokenExpiresAt: 5000 },
    { id: 6, _accessToken: 'new-6', _accessTokenExpiresAt: 5000 }
  ];

  test('should replace the token on every copy of the file', () => {
    const state = buildState();

    applyFileTokens(state, fresh);

    expect(state.users[0]!.avatar!._accessToken).toBe('new-1');
    expect(state.threadMessagesMap[20]![0]!.files[0]!._accessToken).toBe(
      'new-1'
    );
    expect(state.messagesMap[10]![0]!.files[0]!._accessTokenExpiresAt).toBe(
      5000
    );
    expect(state.messagesMap[10]![0]!.reactions[0]!.file!._accessToken).toBe(
      'new-6'
    );
  });

  test('should leave files that were not refreshed alone', () => {
    const state = buildState();

    applyFileTokens(state, fresh);

    expect(state.users[0]!.banner!._accessToken).toBe('token-2');
    expect(state.emojis[0]!.file._accessToken).toBe('token-3');
    expect(state.messagesMap[10]![0]!.files[1]!._accessToken).toBeUndefined();
  });
});
