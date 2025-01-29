import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import Anthropic from '@anthropic-ai/sdk';

export interface IContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
}

interface IMessage {
  role: 'user' | 'assistant';
  content: string | IContentBlock[];
}

export class Assistant {
  private messages: IMessage[] = [];
  private mcpClient: Client;
  private tools: McpTool[] = [];
  private anthropic: Anthropic;
  private MODEL_NAME = 'claude-3-sonnet-20240229';

  constructor(mcpClient: Client, apiKey: string) {
    this.mcpClient = mcpClient;
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  /**
   * Initialize tools from MCP server
   */
  async initializeTools(): Promise<void> {
    try {
      const toolList = await this.mcpClient.listTools();
      this.tools = toolList.tools;
    } catch (error) {
      console.error('Failed to initialize tools:', error);
      throw error;
    }
  }

  /**
   * Process a message and handle any tool use
   */
  async sendMessage(userMessage: string): Promise<IContentBlock[]> {
    // Only add user message if it's not empty (empty means continuing from tool result)
    if (userMessage) {
      this.messages.push({
        role: 'user',
        content: userMessage
      });
    }

    try {
      let keepProcessing = true;
      const allResponseBlocks: IContentBlock[] = [];

      while (keepProcessing) {
        // Send request to Claude with full history
        const response = await this.anthropic.messages.create({
          model: this.MODEL_NAME,
          max_tokens: 4096,
          messages: this.messages.map(msg => ({
            role: msg.role,
            content:
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content)
          })),
          tools: this.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema
          }))
        });

        // Handle tool use
        if (response.stop_reason === 'tool_use') {
          // Get the tool use from the last content item
          const toolUse = response.content[response.content.length - 1];
          if (toolUse.type !== 'tool_use' || !toolUse.name || !toolUse.input) {
            console.error('Invalid tool use response');
            keepProcessing = false;
            continue;
          }

          console.log(
            `======Claude wants to use the ${toolUse.name} tool======`
          );

          try {
            // Execute tool
            const toolResult = await this.mcpClient.callTool({
              name: toolUse.name,
              arguments: toolUse.input as Record<string, unknown>,
              _meta: {}
            });

            // Create tool result block
            const resultBlock: IContentBlock = {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content:
                typeof toolResult === 'string'
                  ? toolResult
                  : JSON.stringify(toolResult)
            };

            // Add tool result to history
            this.messages.push({
              role: 'user',
              content: [resultBlock]
            });

            allResponseBlocks.push(resultBlock);
            keepProcessing = true;
          } catch (error) {
            console.error('Error executing tool:', error);
            keepProcessing = false;
          }
        } else if (response.content[0] && 'text' in response.content[0]) {
          // Handle text response
          const text = response.content[0].text;
          const textBlock: IContentBlock = {
            type: 'text',
            text
          };
          allResponseBlocks.push(textBlock);
          console.log('\nTechNova Support: ' + text);

          // Add text response to history
          this.messages.push({
            role: 'assistant',
            content: [textBlock]
          });

          // Stop processing as we got a text response
          keepProcessing = false;
        }
      }

      return allResponseBlocks;
    } catch (error) {
      console.error('Error processing message:', error);
      const errorBlock: IContentBlock = {
        type: 'text',
        text: 'An error occurred while processing your message.'
      };
      return [errorBlock];
    }
  }

  /**
   * Get the conversation history
   */
  getHistory(): IMessage[] {
    return this.messages;
  }

  /**
   * Clear the conversation history
   */
  clearHistory(): void {
    this.messages = [];
  }
}
