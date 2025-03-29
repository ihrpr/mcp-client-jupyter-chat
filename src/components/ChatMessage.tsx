import React from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  ThinkingBlock,
  ToolUse,
  ToolResult,
  MarkdownContent
} from './MessageComponents';

export interface IChatMessageProps {
  role: 'user' | 'assistant';
  content: any[];
  rendermime: IRenderMimeRegistry;
}

export const ChatMessage = ({
  role,
  content,
  rendermime
}: IChatMessageProps) => {
  return (
    <div className={`mcp-message ${role}`}>
      {content.map((block, index) => {
        if (block.type === 'text' && block.text) {
          return (
            <MarkdownContent
              key={index}
              content={block.text}
              rendermime={rendermime}
            />
          );
        } else if (block.type === 'thinking') {
          return (
            <ThinkingBlock
              key={index}
              content={block.thinking}
              complete={true}
            />
          );
        } else if (block.type === 'tool_use') {
          return <ToolUse key={index} name={block.name} input={block.input} />;
        } else if (block.type === 'tool_result') {
          return (
            <ToolResult
              key={index}
              content={block.content}
              isError={block.is_error}
            />
          );
        }
        return null;
      })}
    </div>
  );
};
