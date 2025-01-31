import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResult,
  Tool as McpTool
} from '@modelcontextprotocol/sdk/types.js';
import Anthropic from '@anthropic-ai/sdk';

export interface IStreamEvent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
}

export class Assistant {
  private messages: Anthropic.Messages.MessageParam[] = [];
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
  async *sendMessage(userMessage: string): AsyncGenerator<IStreamEvent> {
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
              const toolRequesBlock: Anthropic.ContentBlockParam = {
                type: 'tool_use',
                id: currentToolID,
                name: currentToolName,
                input: event.content_block.input as Record<string, unknown>
              };
              yield {
                type: 'tool_use',
                name: currentToolName,
                input: event.content_block.input as Record<string, unknown>
              };
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
                  const toolResult = (await this.mcpClient.callTool({
                    name: currentToolName,
                    arguments: JSON.parse(jsonDelta),
                    _meta: {}
                  })) as CallToolResult;

                  const content: Anthropic.ContentBlockParam[] = [];

                  if (textDelta !== '') {
                    content.push({
                      type: 'text',
                      text: textDelta
                    } as Anthropic.TextBlockParam);
                    yield {
                      type: 'text',
                      text: textDelta
                    };
                  }

                  const toolContent = toolResult.content.map(content => {
                    if (content.type === 'text') {
                      return {
                        type: 'text',
                        text: content.text
                      } as Anthropic.TextBlockParam;
                    } else if (content.type === 'image') {
                      return {
                        type: 'image',
                        source: {
                          type: 'base64',
                          media_type: content.mimeType as
                            | 'image/jpeg'
                            | 'image/png'
                            | 'image/gif'
                            | 'image/webp',
                          data: content.data
                        }
                      } as Anthropic.ImageBlockParam;
                    }
                    return {
                      type: 'text',
                      text: 'content.text'
                    } as Anthropic.TextBlockParam;
                  });

                  const toolResultBlock: Anthropic.ToolResultBlockParam = {
                    type: 'tool_result',
                    tool_use_id: currentToolID,
                    content: toolContent
                  };

                  content.push(toolResultBlock);
                  yield {
                    type: 'tool_result',
                    name: currentToolName,
                    content: JSON.stringify(toolContent)
                  };
                  this.messages.push({
                    role: 'user',
                    content: content
                  });
                } catch (error) {
                  console.error('Error executing tool:', error);
                  const errorBlock: Anthropic.ContentBlockParam = {
                    type: 'text',
                    text: `Error executing tool ${currentToolName}: ${error}`
                  };
                  yield errorBlock;
                  keepProcessing = false;
                } finally {
                  currentToolName = '';
                  currentToolID = '';
                  jsonDelta = '';
                  textDelta = '';
                }
              }
            }
          } else if (event.type === 'message_stop') {
            // Add text response to history
            const textBlock: Anthropic.ContentBlockParam = {
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
        text: 'An error occurred while processing your message.'
      };
    }
  }

  /**
   * Get the conversation history
   */
  getHistory(): Anthropic.Messages.MessageParam[] {
    return this.messages;
  }

  /**
   * Clear the conversation history
   */
  clearHistory(): void {
    this.messages = [];
  }
}
