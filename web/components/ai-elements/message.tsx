'use client';

// MessageResponse from the AI Elements registry, adapted to the Markdown features
// used by this chat: https://elements.ai-sdk.dev/components/message
import { memo, type ComponentProps } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cn } from '../../lib/utils';

export type MessageResponseProps = ComponentProps<typeof Streamdown>;
const plugins = { code };

export const MessageResponse = memo(function MessageResponse({
  className,
  ...props
}: MessageResponseProps) {
  return (
    <Streamdown
      className={cn(
        'w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      plugins={plugins}
      mode="static"
      skipHtml
      linkSafety={{ enabled: false }}
      disallowedElements={['img']}
      controls={{ code: { copy: true, download: false }, table: false }}
      {...props}
    />
  );
});
