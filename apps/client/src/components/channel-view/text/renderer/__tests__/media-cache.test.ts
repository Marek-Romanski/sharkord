import type { TFile, TJoinedMessage } from '@sharkord/shared';
import { describe, expect, test } from 'bun:test';
import { buildMediaSignature } from '../media-cache';

const messageWithFile = (tokenExpiresAt?: number) =>
  ({
    id: 1,
    metadata: [],
    files: [
      {
        id: 7,
        extension: '.png',
        size: 10,
        updatedAt: null,
        _accessTokenExpiresAt: tokenExpiresAt
      } as TFile
    ]
  }) as unknown as TJoinedMessage;

describe('buildMediaSignature', () => {
  test('should change when the access token of a file is replaced', () => {
    // the cached media holds the file url, so a stale signature keeps serving an expired token
    expect(buildMediaSignature(messageWithFile(1000))).not.toBe(
      buildMediaSignature(messageWithFile(2000))
    );
  });

  test('should stay the same while the file is untouched', () => {
    expect(buildMediaSignature(messageWithFile(1000))).toBe(
      buildMediaSignature(messageWithFile(1000))
    );
  });
});
