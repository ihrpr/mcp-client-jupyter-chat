import '../style/index.css';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { Widget, Panel } from '@lumino/widgets';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { INotebookTracker } from '@jupyterlab/notebook';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Assistant } from './assistant';
import { IStreamEvent } from './assistant';

/**
 * Initialization data for the mcp-client-jupyter-chat extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'mcp-client-jupyter-chat:plugin',
  description: 'A JupyterLab extension for Chat with AI supporting MCP',
  autoStart: true,
  requires: [ICommandPalette, INotebookTracker, IRenderMimeRegistry],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    notebookTracker: INotebookTracker,
    rendermime: IRenderMimeRegistry,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension mcp-client-jupyter-chat is activated!');

    // Settings and model management
    interface IModelConfig {
      name: string;
      apiKey: string;
      isDefault: boolean;
    }

    interface IMcpServerConfig {
      name: string;
      url: string;
    }

    interface ISettings {
      models: IModelConfig[];
      mcpServers: IMcpServerConfig[];
    }

    let availableModels: IModelConfig[] = [];
    let selectedModel: IModelConfig | null = null;
    let settingsData: ISettings | null = null;
    const mcpClients: Map<string, Client> = new Map();

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
      const loadSettings = async (settings: ISettingRegistry.ISettings) => {
        settingsData = settings.composite as unknown as ISettings;
        const models = settingsData?.models || [];
        availableModels = Array.isArray(models) ? models : [];
        selectedModel =
          availableModels.find(m => m.isDefault) || availableModels[0] || null;

        console.log(
          'mcp-client-jupyter-chat settings loaded:',
          `models: ${availableModels.length},`,
          `additional servers: ${settingsData?.mcpServers?.length || 0}`
        );
        updateModelDropdown();

        // Reinitialize connections when settings change
        await initializeConnections();
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

    // Initialize MCP clients and assistant
    let assistant: Assistant | null = null;
    let isConnecting = false;

    const initializeConnections = async () => {
      if (isConnecting) {
        return;
      }

      isConnecting = true;

      try {
        // Clean up existing connections
        for (const client of mcpClients.values()) {
          try {
            await client.transport?.close();
          } catch (error) {
            console.error('Error closing client transport:', error);
          }
        }
        mcpClients.clear();

        // Initialize default server client
        const newDefaultClient = new Client(
          {
            name: 'jupyter-mcp-client-default',
            version: '0.1.0'
          },
          {
            capabilities: {
              tools: {},
              resources: {}
            }
          }
        );

        // Connect to default server
        const defaultUrl = new URL('http://localhost:3002/sse');
        const defaultTransport = new SSEClientTransport(defaultUrl);
        await newDefaultClient.connect(defaultTransport);
        mcpClients.set('default', newDefaultClient);
        console.log('Successfully connected to default MCP server');

        // Connect to additional servers from settings
        const additionalServers = settingsData?.mcpServers || [];
        for (const server of additionalServers) {
          const client = new Client(
            {
              name: `jupyter-mcp-client-${server.name}`,
              version: '0.1.0'
            },
            {
              capabilities: {
                tools: {},
                resources: {}
              }
            }
          );

          const transport = new SSEClientTransport(new URL(server.url));
          try {
            await client.connect(transport);
            mcpClients.set(server.name, client);
            console.log(`Successfully connected to MCP server: ${server.name}`);
          } catch (error) {
            console.error(
              `Failed to connect to MCP server ${server.name}:`,
              error
            );
          }
        }

        // Get default client from map
        const defaultClient = mcpClients.get('default');
        if (!defaultClient) {
          throw new Error('Default MCP server not connected');
        }

        // Initialize assistant with all clients
        if (!selectedModel) {
          throw new Error('No model selected');
        }
        assistant = new Assistant(
          mcpClients,
          selectedModel.name,
          selectedModel.apiKey
        );
        await assistant.initializeTools();
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
        mcpClients.clear();
        assistant = null;
      } finally {
        isConnecting = false;
      }
    };

    // Initial connection attempt
    initializeConnections().catch(console.error);

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
        // Render markdown for string content
        const widget = rendermime.createRenderer('text/markdown');
        widget.renderModel({
          data: { 'text/markdown': content },
          trusted: true,
          metadata: {},
          setData: () => {
            /* Required but not used */
          }
        });
        messageDiv.appendChild(widget.node);
      } else {
        // Handle content blocks
        content.forEach(block => {
          const blockDiv = document.createElement('div');

          switch (block.type) {
            case 'text': {
              // Render markdown for text blocks
              const widget = rendermime.createRenderer('text/markdown');
              widget.renderModel({
                data: { 'text/markdown': block.text || '' },
                trusted: true,
                metadata: {},
                setData: () => {
                  /* Required but not used */
                }
              });
              blockDiv.appendChild(widget.node);
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

      if (!assistant || mcpClients.size === 0) {
        addMessage(
          'Not connected to any MCP servers. Attempting to connect...',
          false
        );
        await initializeConnections();
        if (!assistant || mcpClients.size === 0) {
          addMessage(
            'Failed to connect to MCP servers. Please ensure at least the default server is running at http://localhost:3002',
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
        // Get current notebook path from tracker
        const notebookPath = notebookTracker.currentWidget?.context.path;
        const activeCellID =
          notebookTracker.currentWidget?.content.activeCell?.model.id;
        // Process streaming response
        for await (const block of assistant.sendMessage(message, {
          notebookPath,
          activeCellID
        })) {
          let blockDiv = document.createElement('div');

          switch (block.type) {
            case 'text': {
              // Accumulate text for markdown rendering
              if (!currentTextBlock) {
                currentTextBlock = document.createElement('div');
                currentTextBlock.classList.add('mcp-message-markdown');
                messageDiv.appendChild(currentTextBlock);
              }

              // Render markdown for streaming text
              const newText =
                (currentTextBlock.getAttribute('data-text') || '') +
                (block.text || '');
              currentTextBlock.setAttribute('data-text', newText);

              const widget = rendermime.createRenderer('text/markdown');
              widget.renderModel({
                data: { 'text/markdown': newText },
                trusted: true,
                metadata: {},
                setData: () => {
                  /* Required but not used */
                }
              });
              currentTextBlock.innerHTML = '';
              currentTextBlock.appendChild(widget.node);
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

              // Create content container with preserved formatting
              const content = document.createElement('pre');
              content.style.margin = '0';
              content.style.whiteSpace = 'pre-wrap';
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
        mcpClients.clear();
        assistant = null;
        addMessage(
          'Error communicating with MCP servers. Please ensure the servers are running and try again.',
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
