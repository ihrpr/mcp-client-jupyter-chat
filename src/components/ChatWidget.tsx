import React, { useState, useEffect, useRef } from 'react';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IStateDB } from '@jupyterlab/statedb';
import {
  IModelConfig,
  ISettings,
  IStreamEvent,
  INotebookContext
} from '../types';
import { AssistantService } from '../services/assistantService';
import { McpService } from '../services/mcpService';
import { Toolbar } from './Toolbar';
import { StreamingResponse } from './ChatArea';
import { ChatMessage } from './ChatMessage';
import { ChatList } from './ChatList';
import { InputArea } from './InputArea';

interface IChatWidgetProps {
  rendermime: IRenderMimeRegistry;
  notebookTracker: INotebookTracker;
  stateDB: IStateDB;
  settingsData: ISettings | null;
  availableModels: IModelConfig[];
  selectedModel: IModelConfig | null;
  onSelectModel: (model: IModelConfig | null) => void;
}

export const ChatWidget = ({
  rendermime,
  notebookTracker,
  stateDB,
  settingsData,
  availableModels,
  selectedModel,
  onSelectModel
}: IChatWidgetProps) => {
  const [assistant, setAssistant] = useState<AssistantService | null>(null);
  const [mcpService, setMcpService] = useState<McpService>(new McpService());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isShowingHistory, setIsShowingHistory] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<IStreamEvent[]>([]);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  // Initialize connections
  useEffect(() => {
    initializeConnections();
  }, [selectedModel, settingsData]);

  // Auto-scroll to bottom when streaming blocks update
  useEffect(() => {
    if (chatAreaRef.current && streamingBlocks.length > 0) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [streamingBlocks]);

  const initializeConnections = async () => {
    if (isConnecting || !selectedModel) {
      return;
    }

    setIsConnecting(true);

    try {
      // Create new MCP service
      const newMcpService = new McpService();
      await newMcpService.initializeConnections(settingsData);
      setMcpService(newMcpService);

      // Create assistant with MCP service
      const newAssistant = new AssistantService(
        newMcpService,
        selectedModel.name,
        selectedModel.apiKey,
        stateDB
      );
      setAssistant(newAssistant);
    } catch (error) {
      console.error('Failed to initialize connections:', error);
      setAssistant(null);
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle creating a new chat
  const handleNewChat = () => {
    if (assistant) {
      assistant.createNewChat();
      setIsShowingHistory(false);
      setStreamingBlocks([]);
    }
  };

  // Handle showing chat history
  const handleShowHistory = () => {
    setIsShowingHistory(true);
    setStreamingBlocks([]);
  };

  // Get current notebook context
  const getNotebookContext = (): INotebookContext => {
    return {
      notebookPath: notebookTracker.currentWidget?.context.path,
      activeCellID: notebookTracker.currentWidget?.content.activeCell?.model.id
    };
  };

  // Display current chat messages
  const displayCurrentChat = (excludeLastAssistantMessage = false) => {
    if (!assistant) {
      return <div className="mcp-no-messages">No messages yet</div>;
    }

    const messages = assistant.getCurrentChat();
    const processedMessages: JSX.Element[] = [];

    // Process messages and group related sequences into visual messages
    let i = 0;
    let lastAssistantIndex = -1;

    // Find the index of the last assistant message if we need to exclude it
    if (excludeLastAssistantMessage) {
      for (let j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role === 'assistant') {
          lastAssistantIndex = j;
          break;
        }
      }
    }

    while (i < messages.length) {
      const msg = messages[i];

      // Skip the last assistant message if we're streaming (to avoid duplicates)
      if (excludeLastAssistantMessage && i === lastAssistantIndex) {
        i++;
        continue;
      }

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

      // If this is an assistant message, we start a new visual message
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

        // Update the main loop counter
        i = currentMessageIndex;
      } else {
        // Skip any other message type
        i++;
      }
    }

    return processedMessages;
  };

  // Handle sending a message
  const handleSendMessage = async (
    message: string,
    context: INotebookContext
  ) => {
    if (!assistant || !message.trim()) {
      return;
    }

    setIsShowingHistory(false);
    setStreamingBlocks([]);

    // Create a container for streaming blocks
    const blocks: IStreamEvent[] = [];

    try {
      for await (const block of assistant.sendMessage(message, context)) {
        blocks.push(block);
        setStreamingBlocks([...blocks]);
      }

      // Reset streaming blocks after completion
      setStreamingBlocks([]);

      // Refresh notebook if active and modified by tool calls
      if (notebookTracker.currentWidget) {
        await notebookTracker.currentWidget.context.revert();
      }
    } catch (error) {
      console.error('Error handling message:', error);
      blocks.push({
        type: 'text',
        text: 'An error occurred while processing your message.'
      });
      setStreamingBlocks([...blocks]);
    }
  };

  return (
    <div className="mcp-chat">
      <Toolbar
        assistant={assistant}
        mcpService={mcpService}
        onNewChat={handleNewChat}
        onShowHistory={handleShowHistory}
      />

      {isShowingHistory ? (
        // Show chat history
        <ChatList
          assistant={assistant}
          onSelectChat={() => setIsShowingHistory(false)}
        />
      ) : (
        // Show normal chat area
        <div className="mcp-chat-area" ref={chatAreaRef}>
          {/* Show chat history, excluding the last assistant message when streaming */}
          {displayCurrentChat(streamingBlocks.length > 0)}

          {/* Display streaming response if there is any */}
          {streamingBlocks.length > 0 && (
            <StreamingResponse
              blocks={streamingBlocks}
              rendermime={rendermime}
            />
          )}
        </div>
      )}

      <InputArea
        assistant={assistant}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        onSendMessage={handleSendMessage}
        notebookContext={getNotebookContext()}
      />
    </div>
  );
};
