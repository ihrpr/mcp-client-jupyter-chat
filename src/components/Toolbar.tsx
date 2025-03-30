import React from 'react';
import { TokenUsage } from './TokenUsage';
import { AssistantService } from '../services/assistantService';
import { McpService } from '../services/mcpService';
import { icons, createSvgIcon } from '../utils';

interface IToolbarProps {
  assistant: AssistantService | null;
  mcpService: McpService;
  onNewChat: () => void;
  onShowHistory: () => void;
}

export const Toolbar = ({
  assistant,
  mcpService,
  onNewChat,
  onShowHistory
}: IToolbarProps) => {
  const [showToolsPopup, setShowToolsPopup] = React.useState(false);
  const [showServersPopup, setShowServersPopup] = React.useState(false);

  // References to handle clicking outside popups
  const toolsButtonRef = React.useRef<HTMLDivElement>(null);
  const toolsPopupRef = React.useRef<HTMLDivElement>(null);
  const serversButtonRef = React.useRef<HTMLDivElement>(null);
  const serversPopupRef = React.useRef<HTMLDivElement>(null);

  // Hide popups when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Handle tools popup
      if (
        toolsPopupRef.current &&
        toolsButtonRef.current &&
        !toolsPopupRef.current.contains(event.target as Node) &&
        !toolsButtonRef.current.contains(event.target as Node)
      ) {
        setShowToolsPopup(false);
      }

      // Handle servers popup
      if (
        serversPopupRef.current &&
        serversButtonRef.current &&
        !serversPopupRef.current.contains(event.target as Node) &&
        !serversButtonRef.current.contains(event.target as Node)
      ) {
        setShowServersPopup(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const tokenUsage = assistant
    ? assistant.getCurrentChatTokenUsage()
    : {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      };

  return (
    <div className="mcp-toolbar">
      {/* New Chat button */}
      <button
        className="mcp-toolbar-button"
        onClick={onNewChat}
        dangerouslySetInnerHTML={{
          __html: createSvgIcon(icons.newChat) + ' New Chat'
        }}
      />

      {/* History button */}
      <button
        className="mcp-toolbar-button"
        onClick={onShowHistory}
        dangerouslySetInnerHTML={{
          __html: createSvgIcon(icons.history) + ' History'
        }}
      />

      {/* Token Usage */}
      <TokenUsage tokenUsage={tokenUsage} />

      {/* Tools button */}
      <div
        ref={toolsButtonRef}
        className="mcp-tools-button"
        onClick={() => setShowToolsPopup(!showToolsPopup)}
        dangerouslySetInnerHTML={{ __html: createSvgIcon(icons.tools) }}
      />

      {/* Tools popup */}
      <div
        ref={toolsPopupRef}
        className={`mcp-tools-popup ${showToolsPopup ? 'show' : ''}`}
      >
        <div className="mcp-servers-header">Available MCP Tools</div>
        <ToolsList mcpService={mcpService} assistant={assistant} />
      </div>

      {/* Servers button */}
      <div
        ref={serversButtonRef}
        className="mcp-plug-icon"
        onClick={() => setShowServersPopup(!showServersPopup)}
        dangerouslySetInnerHTML={{ __html: createSvgIcon(icons.plug) }}
      />

      {/* Servers popup */}
      <div
        ref={serversPopupRef}
        className={`mcp-servers-popup ${showServersPopup ? 'show' : ''}`}
      >
        <div className="mcp-servers-header">
          All connected MCP servers (use settings to add/remove)
        </div>
        <ServersList mcpService={mcpService} />
      </div>
    </div>
  );
};

interface IToolsListProps {
  mcpService: McpService;
  assistant: AssistantService | null;
}

const ToolsList = ({ mcpService, assistant }: IToolsListProps) => {
  if (!assistant) {
    return (
      <ul className="mcp-tools-list">
        <div className="mcp-no-servers">No MCP tools available</div>
      </ul>
    );
  }

  const mcpClients = mcpService.getClients();
  let totalTools = 0;
  const toolItems: JSX.Element[] = [];

  for (const [serverName] of mcpClients.entries()) {
    try {
      const serverTools = assistant.getServerTools(serverName);
      if (serverTools.length > 0) {
        serverTools.forEach((tool, index) => {
          totalTools++;
          toolItems.push(
            <li key={`${serverName}-${index}`} className="mcp-tools-item">
              <div>
                {tool.name}
                <div className="mcp-tools-server">Server: {serverName}</div>
              </div>
            </li>
          );
        });
      }
    } catch (error) {
      console.error(`Failed to list tools for server ${serverName}:`, error);
    }
  }

  if (totalTools === 0) {
    return (
      <ul className="mcp-tools-list">
        <div className="mcp-no-servers">No MCP tools available</div>
      </ul>
    );
  }

  return <ul className="mcp-tools-list">{toolItems}</ul>;
};

interface IServersListProps {
  mcpService: McpService;
}

const ServersList = ({ mcpService }: IServersListProps) => {
  const mcpClients = mcpService.getClients();

  if (mcpClients.size === 0) {
    return (
      <ul className="mcp-servers-list">
        <div className="mcp-no-servers">No MCP servers connected</div>
      </ul>
    );
  }

  return (
    <ul className="mcp-servers-list">
      {Array.from(mcpClients.keys()).map(name => (
        <li key={name} className="mcp-server-item">
          {name}
        </li>
      ))}
    </ul>
  );
};
