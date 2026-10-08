import { Emoji } from '@/components/emoji';
import { useCustomEmojiFile } from '@/features/server/emojis/hooks';
import { memo } from 'react';

type TEmojiOverrideProps = {
  name: string;
};

// custom emoji are saved into the message with the url they had when it was sent, and that
// url carries a token that expires. reading the file from the store gives the current one
const EmojiOverride = memo(({ name }: TEmojiOverrideProps) => {
  const file = useCustomEmojiFile(name);

  return (
    <span className="emoji-image">
      <Emoji emoji={name} file={file} />
    </span>
  );
});

export { EmojiOverride };
