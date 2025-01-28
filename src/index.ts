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

/**
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

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log(
            'mcp-client-jupyter-chat settings loaded:',
            settings.composite
          );
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

    const input = document.createElement('textarea');
    input.placeholder = 'Message MCP v2...';
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

    // Connect to MCP server using SSE transport through proxy
    const baseUrl = window.location.origin;
    const jupyterBaseUrl =
      document.querySelector('body')?.getAttribute('data-jupyter-api-url') ||
      '/';
    const sseUrl = new URL(`${baseUrl}${jupyterBaseUrl}mcp/sse`);
    const transport = new SSEClientTransport(sseUrl);

    client.connect(transport).catch(console.error);

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      const newHeight = Math.min(input.scrollHeight, window.innerHeight * 0.3);
      input.style.height = newHeight + 'px';
    });

    const sendButton = document.createElement('button');
    sendButton.classList.add('mcp-send-button');

    // Handle chat messages
    const addMessage = (text: string, isUser: boolean) => {
      const messageDiv = document.createElement('div');
      messageDiv.classList.add('mcp-message');
      messageDiv.classList.add(isUser ? 'user' : 'assistant');
      messageDiv.textContent = text;
      chatArea.appendChild(messageDiv);
      chatArea.scrollTop = chatArea.scrollHeight;
    };

    const handleMessage = async (message: string) => {
      // Add user message
      addMessage(message, true);
      addMessage('changes in the code!', false);
      const tools = await client.listTools();
      const tools_str = JSON.stringify(tools);
      addMessage(tools_str, false);

      // Check if message contains "modify"
      if (message.toLowerCase().includes('modify')) {
        const notebook = notebookTracker.currentWidget?.content;
        if (notebook) {
          const activeCell = notebook.activeCell;
          if (activeCell) {
            if (activeCell.model.type === 'code') {
              activeCell.model.sharedModel.setSource('Modified by MCP Chat');
              // Add assistant response
              addMessage("I've modified the current cell for you.", false);
            }
          }
        }
      } else {
        // Default assistant response
        addMessage(
          "I'm here to help! Let me know if you want to modify any cells.",
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

    // Assemble the interface
    inputArea.appendChild(input);
    inputArea.appendChild(sendButton);
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
