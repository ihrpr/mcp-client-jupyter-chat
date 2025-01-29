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
    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage
    });

    try {
      // Send request to Claude
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

      const responseBlocks: IContentBlock[] = [];

      const content = response.content[0];
      if (
        response.stop_reason === 'tool_use' &&
        'tool_calls' in content &&
        Array.isArray(content.tool_calls)
      ) {
        const toolCall = content.tool_calls[0];

        console.log(
          `======Claude wants to use the ${toolCall.name} tool======`
        );

        const toolUseBlock: IContentBlock = {
          type: 'tool_use',
          tool_use_id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments
        };
        responseBlocks.push(toolUseBlock);

        try {
          const toolResult = await this.mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.arguments,
            _meta: {}
          });

          const resultBlock: IContentBlock = {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content:
              typeof toolResult === 'string'
                ? toolResult
                : JSON.stringify(toolResult, null, 2)
          };
          responseBlocks.push(resultBlock);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error occurred';
          const errorBlock: IContentBlock = {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: `Error executing tool: ${errorMessage}`,
            is_error: true
          };
          responseBlocks.push(errorBlock);
        }
      } else if ('text' in content && typeof content.text === 'string') {
        const textBlock: IContentBlock = {
          type: 'text',
          text: content.text
        };
        responseBlocks.push(textBlock);
        console.log('\nTechNova Support: ' + content.text);
      }

      // Add assistant response to history
      this.messages.push({
        role: 'assistant',
        content: responseBlocks
      });

      return responseBlocks;
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
