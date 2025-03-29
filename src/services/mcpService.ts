import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  IMcpServerConfig,
  ISettings,
  McpClientMap,
  McpToolMap
} from '../types';

/**
 * Service for managing MCP clients and connections
 */
export class McpService {
  private mcpClients: McpClientMap = new Map();
  private tools: McpToolMap = new Map();
  private readonly SERVER_TOOL_SEPARATOR: string = '__';

  /**
   * Gets the MCP clients
   */
  getClients(): McpClientMap {
    return this.mcpClients;
  }

  /**
   * Gets the tool separator
   */
  getToolSeparator(): string {
    return this.SERVER_TOOL_SEPARATOR;
  }

  /**
   * Gets the tools for a specific server
   */
  getServerTools(serverName: string): any[] {
    return this.tools.get(serverName) || [];
  }

  /**
   * Gets all tools from all servers
   */
  getAllTools(): McpToolMap {
    return this.tools;
  }

  /**
   * Initializes connections to all MCP servers
   */
  async initializeConnections(settingsData: ISettings | null): Promise<void> {
    try {
      // Clean up existing connections
      for (const client of this.mcpClients.values()) {
        try {
          await client.transport?.close();
        } catch (error) {
          console.error('Error closing client transport:', error);
        }
      }
      this.mcpClients.clear();

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
      this.mcpClients.set('default', newDefaultClient);
      console.log('Successfully connected to default MCP server');

      // Connect to additional servers from settings
      const additionalServers = settingsData?.mcpServers || [];
      for (const server of additionalServers) {
        await this.connectToServer(server);
      }

      // Initialize tools
      await this.initializeTools();

      return;
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
      this.mcpClients.clear();
      throw error;
    }
  }

  /**
   * Connects to a specific MCP server
   */
  private async connectToServer(server: IMcpServerConfig): Promise<void> {
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
      this.mcpClients.set(server.name, client);
      console.log(`Successfully connected to MCP server: ${server.name}`);
    } catch (error) {
      console.error(`Failed to connect to MCP server ${server.name}:`, error);
    }
  }

  /**
   * Initializes tools from all MCP servers
   */
  async initializeTools(): Promise<void> {
    try {
      // Clear existing tools
      this.tools.clear();

      // Initialize tools from each client
      for (const [serverName, client] of this.mcpClients) {
        try {
          const toolList = await client.listTools();
          if (toolList && Array.isArray(toolList.tools)) {
            this.tools.set(serverName, toolList.tools);
          }
          console.log(
            `Initialized ${toolList.tools.length} tools from ${serverName}`
          );
        } catch (error) {
          console.error(
            `Failed to initialize tools from ${serverName}:`,
            error
          );
        }
      }

      if (this.tools.size === 0) {
        throw new Error('No tools available from any MCP server');
      }
    } catch (error) {
      console.error('Failed to initialize tools:', error);
      throw error;
    }
  }
}
