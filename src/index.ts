import '../style/index.css';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { Widget, Panel } from '@lumino/widgets';
import { INotebookTracker } from '@jupyterlab/notebook';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Assistant } from './assistant';
import { IStreamEvent } from './assistant'; /**
 * Initialization data for the mcp-client-jupyter-chat extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'mcp-client-jupyter-chat:plugin',
  description: 'A JupyterLab extension for Chat with AI supporting MCP',
  autoStart: true,
  requires: [ICommandPalette, INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension mcp-client-jupyter-chat is activated!');

    // Settings and model management
    interface IModelConfig {
      name: string;
      apiKey: string;
      isDefault: boolean;
    }

    interface ISettings {
      models: IModelConfig[];
    }

    let availableModels: IModelConfig[] = [];
    let selectedModel: IModelConfig | null = null;

    // Create model dropdown
    const modelSelectWrapper = document.createElement('div');
    modelSelectWrapper.classList.add('mcp-model-select');
    const modelSelect = document.createElement('select');

    const updateModelDropdown = () => {
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

    modelSelect.addEventListener('change', () => {
      selectedModel =
        availableModels.find(m => m.name === modelSelect.value) || null;
    });

    // Load and watch settings
    if (settingRegistry) {
      const loadSettings = (settings: ISettingRegistry.ISettings) => {
        const settingsData = settings.composite as unknown as ISettings;
        const models = settingsData?.models || [];
        availableModels = Array.isArray(models) ? models : [];
        selectedModel =
          availableModels.find(m => m.isDefault) || availableModels[0] || null;

        console.log(
          'mcp-client-jupyter-chat settings loaded:',
          `models: ${availableModels.length}`
        );
        updateModelDropdown();
      };

      settingRegistry
        .load(plugin.id)
        .then(settings => {
          loadSettings(settings);
          // Watch for setting changes
          settings.changed.connect(loadSettings);
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for mcp-client-jupyter-chat.',
            reason
          );
        });
    }

    // Create a chat widget
    const content = new Widget();
    const div = document.createElement('div');
    div.classList.add('mcp-chat');

    const chatArea = document.createElement('div');
    chatArea.classList.add('mcp-chat-area');

    const inputArea = document.createElement('div');
    inputArea.classList.add('mcp-input-area');

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('mcp-input-wrapper');

    const input = document.createElement('textarea');
    input.placeholder = 'Message MCP v3!...';
    input.classList.add('mcp-input');

    // Initialize MCP client
    const client = new Client(
      {
        name: 'jupyter-mcp-client',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    // Initialize assistant
    let assistant: Assistant | null = null;

    let transport: SSEClientTransport | null = null;
    let isConnected = false;
    let isConnecting = false;

    const initializeConnection = async () => {
      if (isConnecting) {
        return;
      }

      isConnecting = true;

      try {
        // Clean up existing transport if any
        if (transport) {
          try {
            await transport.close();
          } catch (error) {
            console.log('Error closing existing transport:', error);
          }
          transport = null;
        }

        // Create new transport with HTTP instead of HTTPS and no-cors mode
        const url = new URL('http://localhost:3002/sse');
        transport = new SSEClientTransport(url);

        await client.connect(transport);
        isConnected = true;
        console.log('Successfully connected to MCP server');

        // Get selected model's API key
        if (!selectedModel) {
          throw new Error('No model selected');
        }

        // Initialize assistant after successful connection
        assistant = new Assistant(
          client,
          selectedModel.name,
          selectedModel.apiKey
        );
        await assistant.initializeTools();

        transport.onclose = () => {
          console.log('SSE transport closed');
          isConnected = false;
          transport = null;
          assistant = null;
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('CORS')) {
          console.warn(
            'CORS error detected. The MCP server must be configured with these headers:\n' +
              '  Access-Control-Allow-Origin: http://localhost:8888\n' +
              '  Access-Control-Allow-Methods: GET\n' +
              '  Access-Control-Allow-Headers: Accept, Origin\n'
          );
        }
        isConnected = false;
        transport = null;
        assistant = null;
      } finally {
        isConnecting = false;
      }
    };

    // Initial connection attempt
    initializeConnection().catch(console.error);

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      const newHeight = Math.min(input.scrollHeight, window.innerHeight * 0.3);
      input.style.height = newHeight + 'px';
    });

    const sendButton = document.createElement('button');
    sendButton.classList.add('mcp-send-button');

    // Handle chat messages
    const addMessage = (content: string | IStreamEvent[], isUser: boolean) => {
      const messageDiv = document.createElement('div');
      messageDiv.classList.add('mcp-message');
      messageDiv.classList.add(isUser ? 'user' : 'assistant');

      if (typeof content === 'string') {
        messageDiv.textContent = content;
      } else {
        // Handle content blocks
        content.forEach(block => {
          const blockDiv = document.createElement('div');

          switch (block.type) {
            case 'text': {
              blockDiv.textContent = block.text || '';
              break;
            }
            case 'tool_use': {
              blockDiv.textContent = `[Using tool: ${block.name}]`;
              blockDiv.classList.add('tool-use');
              break;
            }
            case 'tool_result': {
              blockDiv.classList.add('tool-result');
              if (block.is_error) {
                blockDiv.classList.add('error');
              }

              // Create header with expand/collapse button
              const header = document.createElement('div');
              header.classList.add('tool-result-header');
              header.textContent = 'Tool Result';

              const toggleButton = document.createElement('button');
              toggleButton.classList.add('tool-result-toggle');
              toggleButton.textContent = 'Expand';
              toggleButton.onclick = () => {
                const isExpanded = blockDiv.classList.toggle('expanded');
                toggleButton.textContent = isExpanded ? 'Collapse' : 'Expand';
              };
              header.appendChild(toggleButton);
              blockDiv.appendChild(header);

              // Create content container
              const content = document.createElement('div');
              content.textContent =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content, null, 2);
              blockDiv.appendChild(content);
              break;
            }
          }

          messageDiv.appendChild(blockDiv);
        });
      }

      chatArea.appendChild(messageDiv);
      chatArea.scrollTop = chatArea.scrollHeight;
    };

    const handleMessage = async (message: string) => {
      // Add user message
      addMessage(message, true);

      if (!isConnected || !assistant) {
        addMessage(
          'Not connected to MCP server. Attempting to connect...',
          false
        );
        await initializeConnection();
        if (!isConnected || !assistant) {
          addMessage(
            'Failed to connect to MCP server. Please ensure the server is running at http://localhost:3002',
            false
          );
          return;
        }
      }

      try {
        // Create message container for streaming response
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('mcp-message', 'assistant');
        chatArea.appendChild(messageDiv);

        let currentTextBlock: HTMLDivElement | null = null;

        // Process streaming response
        for await (const block of assistant.sendMessage(message)) {
          console.log('Received block:', block);
          let blockDiv = document.createElement('div');

          switch (block.type) {
            case 'text': {
              if (!currentTextBlock) {
                currentTextBlock = document.createElement('div');
                messageDiv.appendChild(currentTextBlock);
              }
              currentTextBlock.textContent =
                (currentTextBlock.textContent || '') + (block.text || '');
              break;
            }

            case 'tool_use': {
              currentTextBlock = null;
              blockDiv = document.createElement('div');
              blockDiv.classList.add('tool-use');
              blockDiv.textContent = `[Using tool: ${block.name}]`;
              messageDiv.appendChild(blockDiv);
              break;
            }

            case 'tool_result': {
              currentTextBlock = null;
              blockDiv = document.createElement('div');
              blockDiv.classList.add('tool-result');
              if (block.is_error) {
                blockDiv.classList.add('error');
              }

              // Create header with expand/collapse button
              const header = document.createElement('div');
              header.classList.add('tool-result-header');
              header.textContent = 'Tool Result';

              const toggleButton = document.createElement('button');
              toggleButton.classList.add('tool-result-toggle');
              toggleButton.textContent = 'Expand';
              toggleButton.onclick = () => {
                const isExpanded = blockDiv.classList.toggle('expanded');
                toggleButton.textContent = isExpanded ? 'Collapse' : 'Expand';
              };
              header.appendChild(toggleButton);
              blockDiv.appendChild(header);

              // Create content container
              const content = document.createElement('div');
              content.textContent =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content, null, 2);
              blockDiv.appendChild(content);
              messageDiv.appendChild(blockDiv);
              // Refresh the current notebook after tool calls
              // as the notebook may have been modified
              if (notebookTracker.currentWidget) {
                await notebookTracker.currentWidget.context.revert();
              }
              break;
            }
          }

          // Scroll to bottom as content arrives
          chatArea.scrollTop = chatArea.scrollHeight;
        }
      } catch (error) {
        console.error('Error handling message:', error);
        isConnected = false;
        transport = null;
        assistant = null;
        addMessage(
          'Error communicating with MCP server. Please ensure the server is running and try again.',
          false
        );
      }
    };

    // Add event listeners
    sendButton.addEventListener('click', async () => {
      const message = input.value.trim();
      if (message) {
        await handleMessage(message);
        input.value = '';
      }
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (!e.shiftKey) {
          e.preventDefault();
          const message = input.value.trim();
          if (message) {
            handleMessage(message);
            input.value = '';
            input.style.height = 'auto';
          }
        }
      }
    });

    // Create input container with border
    const inputContainer = document.createElement('div');
    inputContainer.classList.add('mcp-input-container');

    // Assemble the interface
    inputContainer.appendChild(input);
    inputContainer.appendChild(sendButton);
    inputWrapper.appendChild(inputContainer);
    modelSelectWrapper.appendChild(modelSelect);
    inputArea.appendChild(inputWrapper);
    inputArea.appendChild(modelSelectWrapper);
    div.appendChild(chatArea);
    div.appendChild(inputArea);
    content.node.appendChild(div);

    const widget = new Panel();
    widget.id = 'mcp-chat';
    widget.title.label = 'MCP Chat';
    widget.title.closable = true;
    widget.title.caption = 'MCP Chat Interface';
    widget.addWidget(content);

    // Add an application command
    const command = 'mcp:open-chat';
    app.commands.addCommand(command, {
      label: 'Open MCP Chat',
      caption: 'Open the MCP Chat interface',
      isEnabled: () => true,
      execute: () => {
        if (!widget.isAttached) {
          // Attach the widget to the left area if it's not there
          app.shell.add(widget, 'left', { rank: 100 });
        }
        app.shell.activateById(widget.id);
      }
    });

    // Add the command to the palette
    palette.addItem({ command, category: 'MCP' });
  }
};

export default plugin;
