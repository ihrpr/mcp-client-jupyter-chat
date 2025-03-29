import React, { useRef, useEffect, useState } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IStreamEvent } from '../types';
import { AssistantService } from '../services/assistantService';

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

  // Group related blocks together for rendering
  const processedBlocks: Record<string, any> = {};
  let currentTextContent = '';
  let thinkingContent = '';

  blocks.forEach(block => {
    if (block.type === 'text' && block.text) {
      currentTextContent += block.text;
      processedBlocks['text'] = currentTextContent;
    } else if (block.type === 'thinking_delta') {
      if (block.thinking) {
        thinkingContent += block.thinking;
      }
      processedBlocks['thinking'] = {
        content: thinkingContent,
        complete: block.thinking_complete
      };
    } else if (block.type === 'tool_use') {
      processedBlocks[`tool_use_${block.name}`] = {
        name: block.name,
        input: block.input
      };
    } else if (block.type === 'input_json_delta' && block.partial_json) {
      // Handle streaming JSON for tool input
      const toolKey = Object.keys(processedBlocks).find(
        key =>
          key.startsWith('tool_use_') && !processedBlocks[key].inputComplete
      );

      if (toolKey) {
        // Initialize streaming input if needed
        if (!processedBlocks[toolKey].streamingInput) {
          processedBlocks[toolKey].streamingInput = '';
        }

        // Append the new JSON fragment
        processedBlocks[toolKey].streamingInput += block.partial_json;
        processedBlocks[toolKey].isStreaming = true;

        // Try to parse the JSON as it streams in
        try {
          const parsed = JSON.parse(processedBlocks[toolKey].streamingInput);
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
            name: 'Tool',
            streamingInput: block.partial_json,
            isStreaming: true
          };
        } else {
          processedBlocks[placeholderKey].streamingInput += block.partial_json;
        }
      }
    } else if (block.type === 'tool_result') {
      processedBlocks[`tool_result_${block.name}`] = {
        name: block.name,
        content: block.content,
        isError: block.is_error
      };

      // Mark any related tool use as complete
      const toolKey = Object.keys(processedBlocks).find(
        key =>
          key.startsWith('tool_use_') &&
          key.includes(block.name ?? '') &&
          !processedBlocks[key].inputComplete
      );
      if (toolKey) {
        processedBlocks[toolKey].inputComplete = true;
      }
    }
  });

  // Convert processed blocks into renderable content
  const renderableContent: JSX.Element[] = [];

  // Natural ordering: thinking first
  if (processedBlocks['thinking']) {
    renderableContent.push(
      <ThinkingBlock
        key="thinking"
        content={processedBlocks['thinking'].content}
        complete={processedBlocks['thinking'].complete}
      />
    );
  }

  // Then tool uses and results
  const toolElements: JSX.Element[] = [];

  // Check for placeholder first (for immediate streamed input)
  if (processedBlocks['tool_use_placeholder']) {
    const placeholder = processedBlocks['tool_use_placeholder'];
    toolElements.push(
      <div key="tool_use_placeholder" className="tool-use">
        <div className="tool-use-header">Using tool: {placeholder.name}</div>
        <pre className="tool-use-input streaming-input">
          {placeholder.streamingInput}
        </pre>
      </div>
    );
  }

  // Process all other blocks
  Object.entries(processedBlocks).forEach(([key, value]) => {
    if (key.startsWith('tool_use_') && key !== 'tool_use_placeholder') {
      // Display tool use with streaming input if available
      const toolInput = value.parsedInput || value.input || {};
      const isStreaming = value.streamingInput && !value.inputComplete;

      toolElements.push(
        <div key={key} className="tool-use">
          <div className="tool-use-header">Using tool: {value.name}</div>
          {isStreaming || Object.keys(toolInput).length > 0 ? (
            <pre
              className={`tool-use-input ${isStreaming ? 'streaming-input' : ''}`}
            >
              {isStreaming
                ? value.streamingInput
                : JSON.stringify(toolInput, null, 2)}
            </pre>
          ) : null}
        </div>
      );
    } else if (key.startsWith('tool_result_')) {
      toolElements.push(
        <ToolResult key={key} content={value.content} isError={value.isError} />
      );
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
};

interface IMarkdownContentProps {
  content: string;
  rendermime: IRenderMimeRegistry;
}

const MarkdownContent = ({ content, rendermime }: IMarkdownContentProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const widget = rendermime.createRenderer('text/markdown');
      widget.renderModel({
        data: { 'text/markdown': content },
        trusted: true,
        metadata: {},
        setData: () => {
          /* Required but not used */
        }
      });

      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(widget.node);
    }
  }, [content, rendermime]);

  return <div className="mcp-message-markdown" ref={containerRef} />;
};

interface IThinkingBlockProps {
  content: string;
  complete?: boolean;
}

const ThinkingBlock = ({ content, complete = false }: IThinkingBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`mcp-thinking-block ${isExpanded ? 'expanded' : ''}`}>
      <div className="mcp-thinking-header">
        <span
          className="mcp-thinking-title"
          style={{ cursor: 'pointer' }}
          onClick={toggleExpand}
        >
          {complete ? 'Thoughts' : 'Thinking...'}
        </span>
        <button className="mcp-thinking-toggle" onClick={toggleExpand}>
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <pre className="mcp-thinking-content">{content}</pre>
    </div>
  );
};

interface IToolResultProps {
  content: string | any;
  isError?: boolean;
}

const ToolResult = ({ content, isError = false }: IToolResultProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className={`tool-result ${isExpanded ? 'expanded' : ''} ${isError ? 'error' : ''}`}
    >
      <div className="tool-result-header">
        Tool Result
        <button className="tool-result-toggle" onClick={toggleExpand}>
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <pre style={{ margin: '0', whiteSpace: 'pre-wrap' }}>
        {typeof content === 'string'
          ? content
          : JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
};
