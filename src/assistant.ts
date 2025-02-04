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

export interface INotebookContext {
  notebookPath?: string;
  activeCellID?: string;
}

export class Assistant {
  SERVER_TOOL_SEPARATOR: string = '__';
  private messages: Anthropic.Messages.MessageParam[] = [];
  private mcpClients: Map<string, Client>;
  private tools: Map<string, McpTool[]> = new Map();
  private anthropic: Anthropic;
  private modelName: string;

  constructor(
    mcpClients: Map<string, Client>,
    modelName: string,
    apiKey: string
  ) {
    this.mcpClients = mcpClients;
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.modelName = modelName;
  }

  /**
   * Initialize tools from all MCP servers
   */
  async initializeTools(): Promise<void> {
    try {
      // Clear existing tools
      this.tools.clear();

      // Initialize tools from each client
      for (const [serverName, client] of this.mcpClients) {
        try {
          const toolList = await client.listTools();
          this.tools.set(serverName, toolList.tools);
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

  /**
   * Process a message and handle any tool use with streaming
   */
  async *sendMessage(
    userMessage: string,
    context: INotebookContext
  ): AsyncGenerator<IStreamEvent> {
    // Only add user message if it's not empty (empty means continuing from tool result)
    if (userMessage) {
      let message = userMessage;
      if (context.notebookPath !== null) {
        message += `\n Current Notebook Path: ${context.notebookPath}`;
      }
      if (context.activeCellID !== null) {
        message += `\n Active selected cell ID: ${context.activeCellID}`;
      }
      this.messages.push({
        role: 'user',
        content: message
      });
    }
    let keepProcessing = true;
    try {
      while (keepProcessing) {
        let textDelta = '';
        let jsonDelta = '';
        let currentToolName = '';
        let currentToolID = '';
        keepProcessing = false;
        // Create streaming request to Claude
        const stream = this.anthropic.messages.stream({
          model: this.modelName,
          max_tokens: 4096,
          messages: this.messages,
          tools: Array.from(this.tools.entries()).flatMap(
            ([serverName, tools]) =>
              tools.map(tool => ({
                name: `${serverName}${this.SERVER_TOOL_SEPARATOR}${tool.name}`,
                description: tool.description,
                input_schema: tool.inputSchema
              }))
          ),
          system: 'Before answering, explain your reasoning step-by-step.'
        });
        // Process the stream
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              currentToolName = event.content_block.name;
              currentToolID = event.content_block.id;
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              textDelta += event.delta.text;
              yield {
                type: 'text',
                text: event.delta.text
              };
            } else if (event.delta.type === 'input_json_delta') {
              jsonDelta += event.delta.partial_json;
            }
          } else if (event.type === 'message_delta') {
            if (event.delta.stop_reason === 'tool_use') {
              keepProcessing = true;
              if (currentToolName !== '') {
                const content: Anthropic.ContentBlockParam[] = [];
                if (textDelta !== '') {
                  content.push({
                    type: 'text',
                    text: textDelta
                  } as Anthropic.TextBlockParam);
                  textDelta = '';
                }
                const toolInput = JSON.parse(jsonDelta);

                const toolRequesBlock: Anthropic.ContentBlockParam = {
                  type: 'tool_use',
                  id: currentToolID,
                  name: currentToolName,
                  input: toolInput
                };
                content.push(toolRequesBlock);
                yield {
                  type: 'tool_use',
                  name: currentToolName,
                  input: toolInput
                };
                this.messages.push({
                  role: 'assistant',
                  content: content
                });
                try {
                  // Parse server name and tool name
                  const [serverName, toolName] = currentToolName.split(
                    this.SERVER_TOOL_SEPARATOR
                  );
                  const client = this.mcpClients.get(serverName);

                  if (!client) {
                    throw new Error(`MCP server ${serverName} not found`);
                  }

                  // Execute tool on appropriate client
                  const toolResult = (await client.callTool({
                    name: toolName,
                    arguments: toolInput,
                    _meta: {}
                  })) as CallToolResult;

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
                      text: 'Unsupported content type'
                    } as Anthropic.TextBlockParam;
                  });

                  const toolResultBlock: Anthropic.ToolResultBlockParam = {
                    type: 'tool_result',
                    tool_use_id: currentToolID,
                    content: toolContent
                  };

                  yield {
                    type: 'tool_result',
                    name: currentToolName,
                    content: JSON.stringify(toolContent)
                  };
                  this.messages.push({
                    role: 'user',
                    content: [toolResultBlock]
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
            } else {
              if (textDelta !== '') {
                const textBlock: Anthropic.ContentBlockParam = {
                  type: 'text',
                  text: textDelta
                };
                this.messages.push({
                  role: 'assistant',
                  content: [textBlock]
                });
                textDelta = '';
                jsonDelta = '';
              }
            }
          }
        }
        const finalMessage = await stream.finalMessage();
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
