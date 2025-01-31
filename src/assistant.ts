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
  private modelName: string;

  constructor(mcpClient: Client, modelName: string, apiKey: string) {
    this.mcpClient = mcpClient;
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.modelName = modelName;
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
   * Process a message and handle any tool use with streaming
   */
  async *sendMessage(userMessage: string): AsyncGenerator<IContentBlock> {
    // Only add user message if it's not empty (empty means continuing from tool result)
    if (userMessage) {
      this.messages.push({
        role: 'user',
        content: userMessage
      });
    }

    try {
      let keepProcessing = true;
      let textDelta = '';
      let jsonDelta = '';
      let currentToolName = '';
      let currentToolID = '';
      while (keepProcessing) {
        keepProcessing = false;
        // Create streaming request to Claude
        const stream = await this.anthropic.messages.stream({
          model: this.modelName,
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
        // Process the stream
        for await (const event of stream) {
          console.log('Event:', event);
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              currentToolName = event.content_block.name;
              currentToolID = event.content_block.id;
              const toolRequesBlock: IContentBlock = {
                type: 'tool_use',
                tool_use_id: currentToolID,
                name: currentToolName,
                input: event.content_block.input as Record<string, unknown>
              };
              yield toolRequesBlock;
              this.messages.push({
                role: 'user',
                content: [toolRequesBlock]
              });
            }
          } else if (event.type === 'content_block_stop') {
            console.log('!! - content block stop:', event);
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              textDelta += event.delta.text;
            } else if (event.delta.type === 'input_json_delta') {
              jsonDelta += event.delta.partial_json;
            }
          } else if (event.type === 'message_delta') {
            if (event.delta.stop_reason === 'tool_use') {
              keepProcessing = true;
              if (currentToolName !== '') {
                try {
                  // Execute tool
                  const toolResult = await this.mcpClient.callTool({
                    name: currentToolName,
                    arguments: JSON.parse(jsonDelta),
                    _meta: {}
                  });

                  // Create and yield tool result block
                  const resultBlock: IContentBlock = {
                    type: 'tool_result',
                    tool_use_id: currentToolID,
                    content:
                      typeof toolResult === 'string'
                        ? toolResult
                        : JSON.stringify(toolResult),
                    text: textDelta
                  };
                  yield resultBlock;
                  this.messages.push({
                    role: 'user',
                    content: [resultBlock]
                  });
                } catch (error) {
                  console.error('Error executing tool:', error);
                  const errorBlock: IContentBlock = {
                    type: 'text',
                    text: `Error executing tool ${currentToolName}: ${error}`,
                    is_error: true
                  };
                  console.log('!! - Tool error:', errorBlock);
                  yield errorBlock;
                  keepProcessing = false;
                } finally {
                  currentToolName = '';
                  currentToolID = '';
                  jsonDelta = '';
                  textDelta = '';
                  jsonDelta = '';
                }
              }
            }
          } else if (event.type === 'message_stop') {
            // Add text response to history
            const textBlock: IContentBlock = {
              type: 'text',
              text: textDelta
            };

            yield textBlock;
            this.messages.push({
              role: 'user',
              content: [textBlock]
            });
            textDelta = '';
            jsonDelta = '';
            console.log('!! - message stop:', event);
          }
        }
        const finalMessage = stream.finalMessage();
        console.log('Final message:', finalMessage);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      yield {
        type: 'text',
        text: 'An error occurred while processing your message.',
        is_error: true
      };
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
