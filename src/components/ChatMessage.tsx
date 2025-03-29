import React, { useState, useEffect } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';

interface IThinkingBlockProps {
  content: string;
}

const ThinkingBlock: React.FC<IThinkingBlockProps> = ({ content }) => {
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
          Thoughts
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

const ToolResult: React.FC<IToolResultProps> = ({
  content,
  isError = false
}) => {
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

interface IMarkdownContentProps {
  content: string;
  rendermime: IRenderMimeRegistry;
}

const MarkdownContent: React.FC<IMarkdownContentProps> = ({
  content,
  rendermime
}) => {
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

export interface IChatMessageProps {
  role: 'user' | 'assistant';
  content: any[];
  rendermime: IRenderMimeRegistry;
}

export const ChatMessage: React.FC<IChatMessageProps> = ({
  role,
  content,
  rendermime
}) => {
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
          return <ThinkingBlock key={index} content={block.thinking} />;
        } else if (block.type === 'tool_use') {
          return (
            <div key={index} className="tool-use">
              [Using tool: {block.name}]
            </div>
          );
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
