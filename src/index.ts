import '../style/index.css';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { Panel } from '@lumino/widgets';
import { LabIcon } from '@jupyterlab/ui-components';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IStateDB } from '@jupyterlab/statedb';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { icons } from './utils';
import { ChatWidget } from './components/ChatWidget';
import { useSettings } from './hooks/useSettings';

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

    // Create MCP logo icon
    const mcpLogo = new LabIcon({
      name: 'mcp:logo',
      svgstr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons.mcpLogo}</svg>`
    });

    // Create widget panel
    const panel = new Panel();
    panel.id = 'mcp-chat';
    panel.title.label = '';
    panel.title.icon = mcpLogo;
    panel.title.closable = true;
    panel.title.caption = 'MCP Chat Interface';

    // Create React root element
    const root = document.createElement('div');
    root.className = 'mcp-root';
    panel.addWidget({ node: root } as any);

    // Create React component
    const ChatApp: React.FC = () => {
      // Use the settings hook
      const {
        settings,
        availableModels,
        selectedModel,
        setSelectedModel,
        isLoading
      } = useSettings(settingRegistry, plugin.id);

      // Wait for settings to load
      if (isLoading) {
        return React.createElement(
          'div',
          { className: 'mcp-loading' },
          'Loading settings...'
        );
      }

      return React.createElement(ChatWidget, {
        rendermime,
        notebookTracker,
        stateDB,
        settingsData: settings,
        availableModels,
        selectedModel,
        onSelectModel: setSelectedModel
      });
    };

    // Render React component
    const reactRoot = createRoot(root);
    reactRoot.render(React.createElement(ChatApp));

    // Add an application command
    const command = 'mcp:open-chat';
    app.commands.addCommand(command, {
      label: 'Open Chat',
      caption: 'Open Chat Interface',
      isEnabled: () => true,
      execute: () => {
        if (!panel.isAttached) {
          // Attach the widget to the left area if it's not there
          app.shell.add(panel, 'left', { rank: 100 });
        }
        app.shell.activateById(panel.id);
      }
    });

    // Add the command to the palette
    palette.addItem({ command, category: 'MCP' });

    // Automatically open the MCP Chat tab on activation
    app.commands.execute(command);
  }
};

export default plugin;
