import React, { useRef, useEffect, useState } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ChatMessage } from './ChatMessage';
import { IStreamEvent } from '../types';
import { AssistantService } from '../services/assistantService';

interface IChatAreaProps {
  assistant: AssistantService | null;
  rendermime: IRenderMimeRegistry;
}

export const ChatArea = ({ assistant, rendermime }: IChatAreaProps) => {
  const chatAreaRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  });

  const displayCurrentChat = () => {
    if (!assistant) {
      return <div className="mcp-no-messages">No messages yet</div>;
    }

    const messages = assistant.getCurrentChat();
    const processedMessages: JSX.Element[] = [];

    // Process messages and group related sequences into visual messages
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];

      // Handle regular user messages (not tool results)
      if (
        msg.role === 'user' &&
        (typeof msg.content === 'string' ||
          (Array.isArray(msg.content) &&
            !msg.content.some(block => block.type === 'tool_result')))
      ) {
        if (typeof msg.content === 'string') {
          processedMessages.push(
            <ChatMessage
              key={`user-${i}`}
              role="user"
              content={[{ type: 'text', text: msg.content }]}
              rendermime={rendermime}
            />
          );
        } else if (Array.isArray(msg.content)) {
          processedMessages.push(
            <ChatMessage
              key={`user-${i}`}
              role="user"
              content={msg.content}
              rendermime={rendermime}
            />
          );
        }
        i++;
        continue;
      }

      // If this is an assistant message, we start a new visual message that might include multiple
      // logical messages (assistant content, tool results, and subsequent assistant responses)
      if (msg.role === 'assistant') {
        // Variables to track state while processing this sequence
        let currentMessageIndex = i;
        let sequenceContent: any[] = [];

        // Process the entire sequence until we find a non-tool-result user message
        while (currentMessageIndex < messages.length) {
          const currentMsg = messages[currentMessageIndex];

          // If we hit a user message that is NOT a tool result, stop the sequence
          if (
            currentMsg.role === 'user' &&
            (typeof currentMsg.content === 'string' ||
              (Array.isArray(currentMsg.content) &&
                !currentMsg.content.some(
                  block => block.type === 'tool_result'
                )))
          ) {
            break;
          }

          // Process content blocks from this message
          if (Array.isArray(currentMsg.content)) {
            sequenceContent = [...sequenceContent, ...currentMsg.content];
          } else if (typeof currentMsg.content === 'string') {
            sequenceContent.push({ type: 'text', text: currentMsg.content });
          }

          // Move to the next message in the sequence
          currentMessageIndex++;
        }

        processedMessages.push(
          <ChatMessage
            key={`assistant-${i}`}
            role="assistant"
            content={sequenceContent}
            rendermime={rendermime}
          />
        );

        // Update the main loop counter to either the user message or the end of the messages
        i = currentMessageIndex;
      } else {
        // Skip any other message type
        i++;
      }
    }

    return processedMessages;
  };

  // ChatList component is implemented in ChatWidget

  return (
    <div className="mcp-chat-area" ref={chatAreaRef}>
      {displayCurrentChat()}
    </div>
  );
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
    } else if (block.type === 'tool_result') {
      processedBlocks[`tool_result_${block.name}`] = {
        name: block.name,
        content: block.content,
        isError: block.is_error
      };
    }
  });

  // Convert processed blocks into renderable content
  const renderableContent: JSX.Element[] = [];

  if (processedBlocks['text']) {
    renderableContent.push(
      <MarkdownContent
        key="text"
        content={processedBlocks['text']}
        rendermime={rendermime}
      />
    );
  }

  if (processedBlocks['thinking']) {
    renderableContent.push(
      <ThinkingBlock
        key="thinking"
        content={processedBlocks['thinking'].content}
        complete={processedBlocks['thinking'].complete}
      />
    );
  }

  // Add tool uses and results
  Object.entries(processedBlocks).forEach(([key, value]) => {
    if (key.startsWith('tool_use_')) {
      renderableContent.push(
        <div key={key} className="tool-use">
          [Using tool: {value.name}]
        </div>
      );
    } else if (key.startsWith('tool_result_')) {
      renderableContent.push(
        <ToolResult key={key} content={value.content} isError={value.isError} />
      );
    }
  });

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
