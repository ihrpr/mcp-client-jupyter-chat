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
  content: any[] | string;
  rendermime: IRenderMimeRegistry;
}

export const ChatMessage = ({
  role,
  content,
  rendermime
}: IChatMessageProps) => {
  // Handle case where content might not be an array
  const contentArray = Array.isArray(content)
    ? content
    : [
      {
        type: 'text',
        text: typeof content === 'string' ? content : JSON.stringify(content)
      }
    ];

  // Safely render each block
  const renderBlocks = () => {
    if (!Array.isArray(contentArray)) {
      return <div className="mcp-error">Error: Invalid content format</div>;
    }

    return contentArray.map((block, index) => {
      if (!block) {
        return null;
      }

      try {
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
              content={block.thinking || block.content || ''}
              complete={true}
            />
          );
        } else if (block.type === 'tool_use') {
          return (
            <ToolUse
              key={index}
              name={block.name || 'Unknown Tool'}
              input={block.input}
              streamingInput={block.streamingInput}
              isStreaming={!!block.isStreaming}
            />
          );
        } else if (block.type === 'tool_result') {
          return (
            <ToolResult
              key={index}
              content={block.content || ''}
              isError={!!block.is_error}
            />
          );
        }
      } catch (error) {
        console.error('Error rendering message block:', error, block);
        return (
          <div key={index} className="mcp-error">
            Error rendering content
          </div>
        );
      }
      return null;
    });
  };

  return <div className={`mcp-message ${role}`}>{renderBlocks()}</div>;
};
