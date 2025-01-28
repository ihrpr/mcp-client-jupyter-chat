import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * Initialization data for the mcp-client-jupyter-chat extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'mcp-client-jupyter-chat:plugin',
  description: 'A JupyterLab extension for Chat with AI supporting MCP',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension mcp-client-jupyter-chat is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('mcp-client-jupyter-chat settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for mcp-client-jupyter-chat.', reason);
        });
    }
  }
};

export default plugin;
