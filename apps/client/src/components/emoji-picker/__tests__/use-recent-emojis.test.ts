import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { describe, expect, test } from 'bun:test';
import { withFreshCustomEmojis } from '../use-recent-emojis';

const custom = (name: string, fallbackImage: string): TEmojiItem => ({
  name,
  shortcodes: [name],
  fallbackImage
});

describe('withFreshCustomEmojis', () => {
  test('should swap the stored url of a custom emoji for the current one', () => {
    const result = withFreshCustomEmojis(
      [custom('party', '/public/a?accessToken=old')],
      [custom('party', '/public/a?accessToken=new')]
    );

    expect(result[0]!.fallbackImage).toBe('/public/a?accessToken=new');
  });

  test('should leave built in emoji alone, even when a custom one has the same name', () => {
    const builtIn: TEmojiItem = {
      name: 'fox',
      shortcodes: ['fox'],
      emoji: 'F',
      fallbackImage: 'https://github.example/fox.png'
    };

    const result = withFreshCustomEmojis(
      [builtIn],
      [custom('fox', '/public/b?accessToken=new')]
    );

    expect(result[0]).toBe(builtIn);
  });

  test('should keep a custom emoji that no longer exists as it was stored', () => {
    const stored = custom('gone', '/public/c?accessToken=old');

    expect(withFreshCustomEmojis([stored], [])[0]).toBe(stored);
  });
});
