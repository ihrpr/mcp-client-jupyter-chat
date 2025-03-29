import React, { useState, useRef } from 'react';
import { IModelConfig, INotebookContext } from '../types';
import { updateModelDropdown } from '../utils';
import { AssistantService } from '../services/assistantService';

interface IInputAreaProps {
  assistant: AssistantService | null;
  availableModels: IModelConfig[];
  selectedModel: IModelConfig | null;
  onSelectModel: (model: IModelConfig | null) => void;
  onSendMessage: (message: string, context: INotebookContext) => void;
  notebookContext: INotebookContext;
}

export const InputArea: React.FC<IInputAreaProps> = ({
  assistant,
  availableModels,
  selectedModel,
  onSelectModel,
  onSendMessage,
  notebookContext
}) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);

  // Initialize model dropdown
  React.useEffect(() => {
    if (modelSelectRef.current) {
      updateModelDropdown(
        modelSelectRef.current,
        availableModels,
        selectedModel
      );
    }
  }, [availableModels, selectedModel]);

  // Auto-resize textarea
  const resizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(
        textareaRef.current.scrollHeight,
        window.innerHeight * 0.3
      );
      textareaRef.current.style.height = newHeight + 'px';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    resizeTextarea();
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedModelName = e.target.value;
    const newSelectedModel =
      availableModels.find(m => m.name === selectedModelName) || null;
    onSelectModel(newSelectedModel);
  };

  const handleSendMessage = () => {
    if (message.trim()) {
      onSendMessage(message.trim(), notebookContext);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="mcp-input-area">
      <div className="mcp-input-wrapper">
        <div className="mcp-input-container">
          <textarea
            ref={textareaRef}
            className="mcp-input"
            placeholder="Message MCP v3!..."
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <button className="mcp-send-button" onClick={handleSendMessage} />
        </div>
      </div>

      <div className="mcp-model-select">
        <select ref={modelSelectRef} onChange={handleModelChange} />
      </div>
    </div>
  );
};
