import React from 'react';
import { AssistantService } from '../services/assistantService';

interface IChatListProps {
  assistant: AssistantService | null;
  onSelectChat: (chatId: string) => void;
}

export const ChatList = ({ assistant, onSelectChat }: IChatListProps) => {
  if (!assistant) {
    return <div className="mcp-no-chats">No chats available</div>;
  }

  const chats = assistant.getChats();
  if (chats.length === 0) {
    return <div className="mcp-no-chats">No chat history</div>;
  }

  return (
    <div className="mcp-chat-list">
      {chats.map(chat => (
        <div
          key={chat.id}
          className="mcp-chat-item"
          onClick={() => {
            if (assistant.loadChat(chat.id)) {
              onSelectChat(chat.id);
            }
          }}
        >
          <div className="mcp-chat-title">{chat.title}</div>
          <div className="mcp-chat-date">
            {new Date(parseInt(chat.createdAt)).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
};
