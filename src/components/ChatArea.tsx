import React, { useRef, useEffect } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IStreamEvent } from '../types';
import { AssistantService } from '../services/assistantService';
import {
  ThinkingBlock,
  ToolUse,
  ToolResult,
  MarkdownContent
} from './MessageComponents';

interface IChatAreaProps {
  assistant: AssistantService | null;
  rendermime: IRenderMimeRegistry;
}

// ChatArea has been refactored and its functionality is now in ChatWidget
export const ChatArea = ({ assistant, rendermime }: IChatAreaProps) => {
  return null; // This component is deprecated - keeping it to avoid breaking imports
};

// Component to handle streaming responses
export interface IStreamingResponseProps {
  blocks: IStreamEvent[];
  rendermime: IRenderMimeRegistry;
}

export const StreamingResponse = ({
  blocks,
  rendermime
}: IStreamingResponseProps) => {
  const messageRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show the latest content
  useEffect(() => {
    if (messageRef.current) {
      const chatArea = messageRef.current.closest('.mcp-chat-area');
      if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    }
  }, [blocks]);

  try {
    // Group related blocks together for rendering
    const processedBlocks: Record<string, any> = {};
    let currentTextContent = '';
    let thinkingContent = '';

    if (!Array.isArray(blocks)) {
      console.error('Invalid blocks format:', blocks);
      return (
        <div className="mcp-message assistant" ref={messageRef}>
          <div className="mcp-error">Error: Invalid stream event format</div>
        </div>
      );
    }

    blocks.forEach(block => {
      try {
        if (!block || typeof block !== 'object') {
          console.warn('Skipping invalid block:', block);
          return;
        }

        if (block.type === 'text' && block.text) {
          currentTextContent += block.text;
          processedBlocks['text'] = currentTextContent;
        } else if (block.type === 'thinking_delta') {
          if (block.thinking) {
            thinkingContent += block.thinking;
          }
          processedBlocks['thinking'] = {
            content: thinkingContent,
            complete: !!block.thinking_complete
          };
        } else if (block.type === 'tool_use') {
          const name = block.name || 'Unknown Tool';
          processedBlocks[`tool_use_${name}`] = {
            name: name,
            input: block.input || {}
          };
        } else if (block.type === 'input_json_delta' && block.partial_json) {
          // Handle streaming JSON for tool input
          const toolKey = Object.keys(processedBlocks).find(
            key =>
              key.startsWith('tool_use_') && !processedBlocks[key].inputComplete
          );

          if (toolKey) {
            if (!processedBlocks[toolKey].streamingInput) {
              processedBlocks[toolKey].streamingInput = '';
            }
            processedBlocks[toolKey].streamingInput += block.partial_json;

            // Try to parse the JSON as it streams in
            try {
              const parsed = JSON.parse(
                processedBlocks[toolKey].streamingInput
              );
              processedBlocks[toolKey].parsedInput = parsed;
            } catch (e) {
              // Ignore parsing errors during streaming
            }
          } else {
            // If we received input_json_delta but don't have a tool_use yet,
            // create a placeholder for any tool that hasn't been created yet
            const placeholderKey = 'tool_use_placeholder';
            if (!processedBlocks[placeholderKey]) {
              processedBlocks[placeholderKey] = {
                name: block.name || 'Tool',
                streamingInput: block.partial_json,
                isStreaming: true
              };
            } else {
              processedBlocks[placeholderKey].streamingInput +=
                block.partial_json;
            }
          }
        } else if (block.type === 'tool_result') {
          const name = block.name || 'Unknown Tool';
          processedBlocks[`tool_result_${name}`] = {
            name: name,
            content: block.content || '',
            isError: !!block.is_error
          };

          // Mark any related tool use as complete
          const toolKey = Object.keys(processedBlocks).find(
            key =>
              key.startsWith('tool_use_') &&
              key.includes(name) &&
              !processedBlocks[key].inputComplete
          );
          if (toolKey) {
            processedBlocks[toolKey].inputComplete = true;
          }
        }
      } catch (e) {
        console.error('Error processing block:', e, block);
      }
    });

    // Convert processed blocks into renderable content
    const renderableContent: JSX.Element[] = [];

    // Natural ordering: thinking first
    if (processedBlocks['thinking']) {
      renderableContent.push(
        <ThinkingBlock
          key="thinking"
          content={processedBlocks['thinking'].content || ''}
          complete={!!processedBlocks['thinking'].complete}
        />
      );
    }

    // Then tool uses and results
    const toolElements: JSX.Element[] = [];

    // Check for placeholder first (for immediate streamed input)
    if (processedBlocks['tool_use_placeholder']) {
      const placeholder = processedBlocks['tool_use_placeholder'];
      toolElements.push(
        <ToolUse
          key="tool_use_placeholder"
          name={placeholder.name || 'Tool'}
          streamingInput={placeholder.streamingInput}
          isStreaming={true}
        />
      );
    }

    // Process all other blocks
    Object.entries(processedBlocks).forEach(([key, value]) => {
      try {
        if (key.startsWith('tool_use_') && key !== 'tool_use_placeholder') {
          // Display tool use with streaming input if available
          const toolInput = value.parsedInput || value.input || {};
          const isStreaming = !!(value.streamingInput && !value.inputComplete);

          toolElements.push(
            <ToolUse
              key={key}
              name={value.name || 'Unknown Tool'}
              input={toolInput}
              streamingInput={value.streamingInput}
              isStreaming={isStreaming}
            />
          );
        } else if (key.startsWith('tool_result_')) {
          toolElements.push(
            <ToolResult
              key={key}
              content={value.content || ''}
              isError={!!value.isError}
            />
          );
        }
      } catch (e) {
        console.error('Error rendering tool element:', e, key, value);
      }
    });
    renderableContent.push(...toolElements);

    // Text appears last, after thinking and tool executions
    if (processedBlocks['text']) {
      renderableContent.push(
        <MarkdownContent
          key="text"
          content={processedBlocks['text']}
          rendermime={rendermime}
        />
      );
    }

    return (
      <div className="mcp-message assistant" ref={messageRef}>
        {renderableContent}
      </div>
    );
  } catch (error) {
    console.error('Error processing streaming response:', error);
    return (
      <div className="mcp-message assistant" ref={messageRef}>
        <div className="mcp-error">
          Error processing response: {String(error)}
        </div>
      </div>
    );
  }
};
