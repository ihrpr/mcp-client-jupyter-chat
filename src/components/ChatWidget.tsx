import React, { useState, useEffect } from 'react';
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
import { ChatArea, StreamingResponse } from './ChatArea';
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

  // Initialize connections
  useEffect(() => {
    initializeConnections();
  }, [selectedModel, settingsData]);

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
        <>
          <ChatArea assistant={assistant} rendermime={rendermime} />

          {/* Display streaming response if there is any */}
          {streamingBlocks.length > 0 && (
            <StreamingResponse
              blocks={streamingBlocks}
              rendermime={rendermime}
            />
          )}
        </>
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
