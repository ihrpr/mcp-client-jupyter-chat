import { IModelConfig } from '../types';

/**
 * Generates a unique chat ID
 */
export const generateChatId = (): string => {
  return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Generates a title for a chat based on the first message
 */
export const generateChatTitle = (messages: any[]): string => {
  if (messages.length === 0) {
    return 'New Chat';
  }

  const firstMessage = messages[0];
  if (typeof firstMessage.content === 'string') {
    const title = firstMessage.content.slice(0, 30);
    return title.length < firstMessage.content.length ? `${title}...` : title;
  }

  return 'New Chat';
};

/**
 * Updates model dropdown with available models
 */
export const updateModelDropdown = (
  modelSelect: HTMLSelectElement,
  availableModels: IModelConfig[],
  selectedModel: IModelConfig | null
): void => {
  modelSelect.innerHTML = '';
  availableModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.name;
    if (model.name === 'gpt-4') {
      option.textContent = 'GPT-4';
    }
    option.selected = model === selectedModel;
    modelSelect.appendChild(option);
  });
};

/**
 * Creates an SVG icon as a string
 */
export const createSvgIcon = (pathData: string): string => {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${pathData}
    </svg>
  `;
};

// SVG path data for icons
export const icons = {
  newChat: '<path d="M12 5v14M5 12h14"/>',
  history: '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  tokenUsage:
    '<path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>',
  tools:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  plug: '<path d="M18.36 5.64a9 9 0 11-12.73 0M12 2v10"/>',
  mcpLogo:
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h8"/><circle cx="4" cy="8" r="1"/><circle cx="20" cy="8" r="1"/><circle cx="4" cy="16" r="1"/><circle cx="20" cy="16" r="1"/>'
};
