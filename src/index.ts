import '../style/index.css';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { Widget, Panel } from '@lumino/widgets';
import { LabIcon } from '@jupyterlab/ui-components';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IStateDB } from '@jupyterlab/statedb';
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
  requires: [ICommandPalette, IStateDB, INotebookTracker, IRenderMimeRegistry],
  optional: [ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    stateDB: IStateDB,
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

    // Create chat area
    const chatArea = document.createElement('div');
    chatArea.classList.add('mcp-chat-area');

    // Function to display chat list
    const displayChatList = () => {
      if (!assistant) {
        console.warn('Cannot display chat list: Assistant not initialized');
        return;
      }

      // Clear existing messages
      chatArea.innerHTML = '';

      // Create chat list container
      const chatListContainer = document.createElement('div');
      chatListContainer.classList.add('mcp-chat-list');

      // Get and display chat list
      const chats = assistant.getChats();
      chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.classList.add('mcp-chat-item');

        const chatTitle = document.createElement('div');
        chatTitle.classList.add('mcp-chat-title');
        chatTitle.textContent = chat.title;

        const chatDate = document.createElement('div');
        chatDate.classList.add('mcp-chat-date');
        chatDate.textContent = new Date(
          parseInt(chat.createdAt)
        ).toLocaleString();

        chatItem.appendChild(chatTitle);
        chatItem.appendChild(chatDate);

        chatItem.addEventListener('click', () => {
          if (assistant?.loadChat(chat.id)) {
            displayCurrentChat();
          }
        });

        chatListContainer.appendChild(chatItem);
      });

      chatArea.appendChild(chatListContainer);
    };

    // Function to display current chat
    const displayCurrentChat = () => {
      if (!assistant) {
        console.warn('Cannot display chat: Assistant not initialized');
        return;
      }

      // Clear existing messages
      chatArea.innerHTML = '';

      // Get and display current chat
      const messages = assistant.getCurrentChat();
      messages.forEach(msg => {
        if (typeof msg.content === 'string') {
          addMessage(msg.content, msg.role === 'user');
        } else {
          // Convert content blocks to IStreamEvent array
          const events: IStreamEvent[] = msg.content.map(block => {
            if ('text' in block) {
              return {
                type: 'text',
                text: block.text
              } as IStreamEvent;
            } else if (block.type === 'tool_use') {
              return {
                type: 'tool_use',
                name: block.name,
                input: block.input as Record<string, unknown>
              } as IStreamEvent;
            } else if (block.type === 'tool_result') {
              return {
                type: 'tool_result',
                content: JSON.stringify(block.content)
              } as IStreamEvent;
            }
            return {
              type: 'text',
              text: 'Unsupported content type'
            } as IStreamEvent;
          });
          addMessage(events, msg.role === 'user');
        }
      });
    };

    // Create toolbar
    const toolbar = document.createElement('div');
    toolbar.classList.add('mcp-toolbar');

    // New Chat button
    const newChatButton = document.createElement('button');
    newChatButton.classList.add('mcp-toolbar-button');
    newChatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      New Chat
    `;
    newChatButton.addEventListener('click', () => {
      if (assistant) {
        assistant.createNewChat();
        displayCurrentChat();
      }
    });

    // History button
    const historyButton = document.createElement('button');
    historyButton.classList.add('mcp-toolbar-button');
    historyButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      History
    `;
    historyButton.addEventListener('click', displayChatList);

    // Add tools button
    const toolsButton = document.createElement('div');
    toolsButton.classList.add('mcp-tools-button');
    toolsButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    `;

    // Create tools popup
    const toolsPopup = document.createElement('div');
    toolsPopup.classList.add('mcp-tools-popup');

    // Add click handler for tools button
    toolsButton.addEventListener('click', async () => {
      if (!assistant) {
        console.warn('Cannot list tools: Assistant not initialized');
        return;
      }

      // Clear previous content
      toolsPopup.innerHTML = '';

      // Add header
      const header = document.createElement('div');
      header.classList.add('mcp-servers-header');
      header.textContent = 'Available MCP Tools';
      toolsPopup.appendChild(header);

      // Create tools list
      const toolsList = document.createElement('ul');
      toolsList.classList.add('mcp-tools-list');

      let totalTools = 0;

      for (const [serverName] of mcpClients.entries()) {
        try {
          const serverTools = assistant.getServerTools(serverName);
          if (serverTools.length > 0) {
            serverTools.forEach(tool => {
              totalTools++;
              const toolItem = document.createElement('li');
              toolItem.classList.add('mcp-tools-item');

              const toolInfo = document.createElement('div');
              toolInfo.innerHTML = `
                ${tool.name}
                <div class="mcp-tools-server">Server: ${serverName}</div>
              `;

              toolItem.appendChild(toolInfo);
              toolsList.appendChild(toolItem);
            });
          }
        } catch (error) {
          console.error(
            `Failed to list tools for server ${serverName}:`,
            error
          );
        }
      }

      if (totalTools === 0) {
        const noTools = document.createElement('div');
        noTools.classList.add('mcp-no-servers');
        noTools.textContent = 'No MCP tools available';
        toolsList.appendChild(noTools);
      }

      toolsPopup.appendChild(toolsList);
      toolsPopup.classList.toggle('show');
    });

    // Add plug icon
    const plugIcon = document.createElement('div');
    plugIcon.classList.add('mcp-plug-icon');
    plugIcon.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18.36 5.64a9 9 0 11-12.73 0M12 2v10"/>
      </svg>
    `;

    // Create servers popup
    const serversPopup = document.createElement('div');
    serversPopup.classList.add('mcp-servers-popup');

    // Add click handler for plug icon
    plugIcon.addEventListener('click', () => {
      // Clear previous content
      serversPopup.innerHTML = '';

      // Add header
      const header = document.createElement('div');
      header.classList.add('mcp-servers-header');
      header.textContent =
        'All connected MCP servers (use settings to add/remove)';
      serversPopup.appendChild(header);

      // Create server list
      const serverList = document.createElement('ul');
      serverList.classList.add('mcp-servers-list');

      if (mcpClients.size > 0) {
        mcpClients.forEach((client, name) => {
          const serverItem = document.createElement('li');
          serverItem.classList.add('mcp-server-item');
          serverItem.textContent = name;
          serverList.appendChild(serverItem);
        });
      } else {
        const noServers = document.createElement('div');
        noServers.classList.add('mcp-no-servers');
        noServers.textContent = 'No MCP servers connected';
        serverList.appendChild(noServers);
      }

      serversPopup.appendChild(serverList);
      serversPopup.classList.toggle('show');
    });

    // Close popups when clicking outside
    document.addEventListener('click', event => {
      if (
        !toolsButton.contains(event.target as Node) &&
        !toolsPopup.contains(event.target as Node)
      ) {
        toolsPopup.classList.remove('show');
      }
      if (
        !plugIcon.contains(event.target as Node) &&
        !serversPopup.contains(event.target as Node)
      ) {
        serversPopup.classList.remove('show');
      }
    });

    toolbar.appendChild(newChatButton);
    toolbar.appendChild(historyButton);
    toolbar.appendChild(toolsButton);
    toolbar.appendChild(toolsPopup);
    toolbar.appendChild(plugIcon);
    toolbar.appendChild(serversPopup);

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
          selectedModel.apiKey,
          stateDB
        );
        await assistant.initializeTools();
        // Wait for history to be loaded before displaying
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure history is loaded
        displayCurrentChat();
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

    // Initial connection attempt and display history
    initializeConnections()
      .then(() => {
        if (assistant) {
          displayCurrentChat();
        }
      })
      .catch(console.error);

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
    div.appendChild(toolbar);
    div.appendChild(chatArea);
    div.appendChild(inputArea);
    content.node.appendChild(div);

    // Create MCP logo icon
    const mcpChatLogoStr = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
        <path d="M8 8h8M8 12h8M8 16h8"/>
        <circle cx="4" cy="8" r="1"/>
        <circle cx="20" cy="8" r="1"/>
        <circle cx="4" cy="16" r="1"/>
        <circle cx="20" cy="16" r="1"/>
      </svg>
    `;
    const mcpLogo = new LabIcon({ name: 'mcp:logo', svgstr: mcpChatLogoStr });

    const widget = new Panel();
    widget.id = 'mcp-chat';
    widget.title.label = '';
    widget.title.icon = mcpLogo;
    widget.title.closable = true;
    widget.title.caption = 'MCP Chat Interface';
    widget.addWidget(content);

    // Add an application command
    const command = 'mcp:open-chat';
    app.commands.addCommand(command, {
      label: 'Open Chat',
      caption: 'Open Chat Interface',
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

    // Automatically open the MCP Chat tab on activation
    app.commands.execute(command);
  }
};

export default plugin;
