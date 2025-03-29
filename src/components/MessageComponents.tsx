import React, { useState, useEffect, useRef } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';

// Thinking block component
export interface IThinkingBlockProps {
  content: string;
  complete?: boolean;
}

export const ThinkingBlock = ({
  content,
  complete = true
}: IThinkingBlockProps) => {
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

// Tool Use component
export interface IToolUseProps {
  name: string;
  input?: Record<string, any> | null;
  streamingInput?: string;
  isStreaming?: boolean;
}

export const ToolUse = ({
  name,
  input,
  streamingInput,
  isStreaming = false
}: IToolUseProps) => {
  const hasInput =
    isStreaming || (input && Object.keys(input || {}).length > 0);
  const [isExpanded, setIsExpanded] = useState(true); // Start expanded for better UX with streaming

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="tool-use">
      <div className="tool-use-header">
        <span>Using tool: {name}</span>
        {hasInput && (
          <button className="tool-use-toggle" onClick={toggleExpand}>
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      {hasInput && isExpanded && (
        <pre
          className={`tool-use-input ${isStreaming ? 'streaming-input' : ''}`}
        >
          {isStreaming && streamingInput
            ? streamingInput
            : JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
};

// Tool Result component
export interface IToolResultProps {
  content: string | any;
  isError?: boolean;
}

export const ToolResult = ({ content, isError = false }: IToolResultProps) => {
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
      <pre className="tool-result-content">
        {typeof content === 'string'
          ? content
          : JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
};

// Markdown Content component
export interface IMarkdownContentProps {
  content: string;
  rendermime: IRenderMimeRegistry;
}

export const MarkdownContent = ({
  content,
  rendermime
}: IMarkdownContentProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
