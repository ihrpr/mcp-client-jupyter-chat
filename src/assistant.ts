import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import Anthropic from '@anthropic-ai/sdk';

interface ITextBlock {
  type: 'text';
  text: string;
}

interface IToolUseBlock {
  type: 'tool_use';
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
}

interface IToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type IContentBlock = ITextBlock | IToolUseBlock | IToolResultBlock;

interface IMessage {
  role: string;
  content: IContentBlock[];
}

interface IToolCall {
  name: string;
  input: Record<string, unknown>;
}

export class Assistant {
  private messages: IMessage[] = [];
  private mcpClient: Client;
  private tools: McpTool[] = [];
  private anthropic: Anthropic;

  constructor(mcpClient: Client, apiKey: string) {
    this.mcpClient = mcpClient;
    this.anthropic = new Anthropic({
      apiKey: apiKey
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
   * Add a user message to the conversation
   */
  async sendMessage(userMessage: string): Promise<IContentBlock[]> {
    // Add user message to history
    const userContent: IContentBlock[] = [
      {
        type: 'text',
        text: userMessage
      } as ITextBlock
    ];

    this.messages.push({
      role: 'user',
      content: userContent
    });

    try {
      // Process message and handle tool use
      const response = await this.processMessage(userMessage);

      // Add assistant response to history
      this.messages.push({
        role: 'assistant',
        content: response
      });

      return response;
    } catch (error) {
      console.error('Error processing message:', error);
      const errorResponse: IContentBlock[] = [
        {
          type: 'text',
          text: 'An error occurred while processing your message.'
        } as ITextBlock
      ];

      this.messages.push({
        role: 'assistant',
        content: errorResponse
      });

      return errorResponse;
    }
  }

  /**
   * Process a message and handle any tool use
   */
  private async processMessage(message: string): Promise<IContentBlock[]> {
    const response: IContentBlock[] = [];

    try {
      // Prepare system prompt with available tools
      const systemPrompt = this.prepareSystemPrompt();

      // Format conversation history for Claude
      const messageHistory = this.formatMessageHistory();

      // Get initial response from Claude
      const completion = await this.anthropic.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messageHistory
      });

      // Parse Claude's response for tool use
      const message = completion.content[0];
      if (!message || !('text' in message)) {
        throw new Error('No response from Claude');
      }
      const toolCall = this.parseToolCall(message.text);

      if (toolCall) {
        // Add thinking block about tool use
        const thinkingBlock: ITextBlock = {
          type: 'text',
          text: `<thinking>Using the ${toolCall.name} tool to help answer your question.</thinking>`
        };
        response.push(thinkingBlock);

        // Create tool use block
        const toolUseId = `toolu_${Date.now()}`;
        const toolUseBlock: IToolUseBlock = {
          type: 'tool_use',
          tool_use_id: toolUseId,
          name: toolCall.name,
          input: toolCall.input
        };
        response.push(toolUseBlock);

        try {
          // Execute tool via MCP
          const result = await this.mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.input,
            _meta: {}
          });

          // Add tool result
          const resultBlock: IToolResultBlock = {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content:
              typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2)
          };
          response.push(resultBlock);

          // Get final response from Claude using tool result
          const finalCompletion = await this.anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [
              ...messageHistory,
              {
                role: 'assistant',
                content: `I used the ${toolCall.name} tool and got this result: ${JSON.stringify(result, null, 2)}`
              }
            ]
          });

          const finalMessage = finalCompletion.content[0];
          if (!finalMessage || !('text' in finalMessage)) {
            throw new Error('No response from Claude');
          }

          // Add final response
          const finalResponseBlock: ITextBlock = {
            type: 'text',
            text: finalMessage.text
          };
          response.push(finalResponseBlock);
        } catch (error) {
          // Handle tool execution error
          const toolErrorMessage =
            error instanceof Error ? error.message : 'Unknown error occurred';
          const errorBlock: IToolResultBlock = {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: `Error executing tool: ${toolErrorMessage}`,
            is_error: true
          };
          response.push(errorBlock);

          // Get error handling response from Claude
          const errorCompletion = await this.anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [
              ...messageHistory,
              {
                role: 'assistant',
                content: `I encountered an error when trying to use the ${toolCall.name} tool: ${toolErrorMessage}`
              }
            ]
          });

          const errorContent = errorCompletion.content[0];
          if (!errorContent || !('text' in errorContent)) {
            throw new Error('No response from Claude');
          }

          const errorResponseBlock: ITextBlock = {
            type: 'text',
            text: errorContent.text
          };
          response.push(errorResponseBlock);
        }
      } else {
        // No tool needed, just add Claude's response
        const responseBlock: ITextBlock = {
          type: 'text',
          text: message.text
        };
        response.push(responseBlock);
      }

      return response;
    } catch (error) {
      console.error('Error in processMessage:', error);
      throw error;
    }
  }

  /**
   * Prepare system prompt with available tools
   */
  private prepareSystemPrompt(): string {
    const toolDescriptions = this.tools
      .map(tool => {
        const params = tool.inputSchema?.properties
          ? Object.entries(tool.inputSchema.properties)
              .map(
                ([name, schema]) =>
                  `${name}: ${(schema as any).description || name}`
              )
              .join('\n')
          : 'No parameters';

        return `
Tool: ${tool.name}
Description: ${tool.description || 'No description provided'}
Parameters:
${params}
`;
      })
      .join('\n');

    return `You are a helpful AI assistant with access to the following tools:

${toolDescriptions}

When you need to use a tool, format your response like this:
<tool_call>
name: [tool name]
input: {
  "param1": "value1",
  "param2": "value2"
}
</tool_call>

Only use tools when necessary. If no tool is needed, respond directly to help the user.`;
  }

  /**
   * Format message history for Claude
   */
  private formatMessageHistory(): Array<{
    role: 'user' | 'assistant';
    content: string;
  }> {
    return this.messages.map(msg => {
      const blocks = msg.content.map(block => {
        if ('text' in block) {
          return block.text;
        } else if ('name' in block && 'input' in block) {
          return `Used tool ${block.name} with input: ${JSON.stringify(block.input)}`;
        } else if ('content' in block) {
          return `Tool result: ${block.content}`;
        }
        return '';
      });

      return {
        role: msg.role as 'user' | 'assistant',
        content: blocks.filter(Boolean).join('\n')
      };
    });
  }

  /**
   * Parse tool call from Claude's response
   */
  private parseToolCall(response: string): IToolCall | null {
    const match = response.match(
      /<tool_call>\s*name:\s*([^\n]+)\s*input:\s*({[^}]+})/s
    );

    if (!match) {
      return null;
    }

    try {
      const name = match[1].trim();
      const input = JSON.parse(match[2]);

      return { name, input };
    } catch (error) {
      console.error('Error parsing tool call:', error);
      return null;
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
