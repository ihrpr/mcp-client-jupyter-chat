import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResult,
  Tool as McpTool
} from '@modelcontextprotocol/sdk/types.js';
import Anthropic from '@anthropic-ai/sdk';
import { IStateDB } from '@jupyterlab/statedb';

// Interfaces that match JupyterLab's state database requirements
interface ISerializedContentBlock {
  type: string;
  text?: string;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Record<string, unknown>;
}

interface ISerializedMessage {
  role: string;
  content: string | ISerializedContentBlock[];
  [key: string]: string | ISerializedContentBlock[] | undefined;
}

interface IChat {
  id: string;
  title: string;
  messages: ISerializedMessage[];
  createdAt: string;
}

interface ISerializedHistory {
  chats: IChat[];
  currentChatId?: string;
}

type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];

// Type for JupyterLab state database values
type StateDBValue = { [key: string]: JSONValue };

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
  private chats: Map<string, Anthropic.Messages.MessageParam[]> = new Map();
  private currentChatId: string | null = null;
  private mcpClients: Map<string, Client>;
  private tools: Map<string, McpTool[]> = new Map();

  /**
   * Get tools for a specific server
   */
  getServerTools(serverName: string): McpTool[] {
    return this.tools.get(serverName) || [];
  }
  private anthropic: Anthropic;
  private modelName: string;
  private stateDB: IStateDB;
  private readonly stateKey: string = 'mcp-chat:conversation-history';

  constructor(
    mcpClients: Map<string, Client>,
    modelName: string,
    apiKey: string,
    stateDB: IStateDB
  ) {
    this.mcpClients = mcpClients;
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.modelName = modelName;
    this.stateDB = stateDB;
    this.loadHistory();
  }

  private generateChatId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateChatTitle(
    messages: Anthropic.Messages.MessageParam[]
  ): string {
    if (messages.length === 0) {
      return 'New Chat';
    }
    const firstMessage = messages[0];
    if (typeof firstMessage.content === 'string') {
      const title = firstMessage.content.slice(0, 30);
      return title.length < firstMessage.content.length ? `${title}...` : title;
    }
    return 'New Chat';
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

  /**
   * Get all chats
   */
  getChats(): { id: string; title: string; createdAt: string }[] {
    return Array.from(this.chats.entries())
      .map(([id, messages]) => ({
        id,
        title: this.generateChatTitle(messages),
        createdAt: id.split('-')[1] // Extract timestamp from ID
      }))
      .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt)); // Sort by creation time, newest first
  }

  /**
   * Get the current chat messages
   */
  getCurrentChat(): Anthropic.Messages.MessageParam[] {
    return this.currentChatId ? this.chats.get(this.currentChatId) || [] : [];
  }

  /**
   * Create a new chat
   */
  createNewChat(): string {
    const chatId = this.generateChatId();
    this.chats.set(chatId, []);
    this.currentChatId = chatId;
    void this.saveHistory();
    return chatId;
  }

  /**
   * Load a specific chat
   */
  loadChat(chatId: string): boolean {
    if (this.chats.has(chatId)) {
      this.currentChatId = chatId;
      void this.saveHistory();
      return true;
    }
    return false;
  }

  /**
   * Delete the current chat
   */
  deleteCurrentChat(): void {
    if (this.currentChatId) {
      this.chats.delete(this.currentChatId);
      // Set current chat to most recent, or create new if none exist
      const remainingChats = Array.from(this.chats.keys());
      if (remainingChats.length > 0) {
        this.currentChatId = remainingChats[remainingChats.length - 1];
      } else {
        this.createNewChat();
      }
      void this.saveHistory();
    }
  }

  /**
   * Process a message and handle any tool use with streaming
   */
  async *sendMessage(
    userMessage: string,
    context: INotebookContext
  ): AsyncGenerator<IStreamEvent> {
    // Create new chat if none exists
    if (!this.currentChatId) {
      this.createNewChat();
    }

    const currentMessages = this.getCurrentChat();

    // Only add user message if it's not empty (empty means continuing from tool result)
    if (userMessage) {
      let message = userMessage;
      if (context.notebookPath !== null) {
        message += `\n Current Notebook Path: ${context.notebookPath}`;
      }
      if (context.activeCellID !== null) {
        message += `\n Active selected cell ID: ${context.activeCellID}`;
      }
      currentMessages.push({
        role: 'user',
        content: message
      });
      await this.saveHistory();
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
          messages: currentMessages,
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
                currentMessages.push({
                  role: 'assistant',
                  content: content
                });
                await this.saveHistory();
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
                  currentMessages.push({
                    role: 'user',
                    content: [toolResultBlock]
                  });
                  await this.saveHistory();
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
                currentMessages.push({
                  role: 'assistant',
                  content: [textBlock]
                });
                await this.saveHistory();
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
   * Save all chats to state database
   */
  private async saveHistory(): Promise<void> {
    // Convert all chats to a serializable format
    const serializedChats = Array.from(this.chats.entries()).map(
      ([id, messages]) => ({
        id,
        title: this.generateChatTitle(messages),
        createdAt: id.split('-')[1],
        messages: messages.map(msg => {
          const serializedContent = Array.isArray(msg.content)
            ? msg.content.map(
                (
                  block: Anthropic.ContentBlockParam
                ): ISerializedContentBlock => {
                  if ('text' in block) {
                    return { type: 'text', text: block.text };
                  }
                  // Convert complex types to a serializable format
                  const serialized: ISerializedContentBlock = {
                    type: block.type,
                    ...Object.entries(block).reduce(
                      (acc, [key, value]) => {
                        // Only include serializable values
                        if (
                          typeof value === 'string' ||
                          typeof value === 'number' ||
                          typeof value === 'boolean' ||
                          value === null
                        ) {
                          acc[key] = value;
                        } else if (typeof value === 'object') {
                          // Convert objects to JSON-safe format
                          acc[key] = JSON.parse(
                            JSON.stringify(value)
                          ) as JSONValue;
                        }
                        return acc;
                      },
                      {} as Record<string, JSONValue>
                    )
                  };
                  return serialized;
                }
              )
            : msg.content;

          return {
            role: msg.role,
            content: serializedContent
          };
        })
      })
    );

    const history = {
      chats: serializedChats,
      currentChatId: this.currentChatId
    } as StateDBValue;

    await this.stateDB.save(this.stateKey, history);
  }

  /**
   * Load all chats from state database
   */
  private async loadHistory(): Promise<void> {
    const savedData = await this.stateDB.fetch(this.stateKey);
    if (
      savedData &&
      typeof savedData === 'object' &&
      'chats' in savedData &&
      Array.isArray(savedData.chats)
    ) {
      // Type assertion after runtime checks
      const savedHistory: ISerializedHistory = {
        chats: savedData.chats,
        currentChatId: savedData.currentChatId as string | undefined
      };
      this.chats.clear();

      savedHistory.chats.forEach(chat => {
        this.chats.set(
          chat.id,
          chat.messages.map(msg => {
            const content = Array.isArray(msg.content)
              ? msg.content.map((block: ISerializedContentBlock) => {
                  if (block.type === 'text') {
                    return {
                      type: 'text',
                      text: block.text
                    } as Anthropic.TextBlockParam;
                  }
                  // Handle other block types as needed
                  return block as Anthropic.ContentBlockParam;
                })
              : msg.content;

            return {
              role: msg.role as Anthropic.Messages.MessageParam['role'],
              content
            };
          })
        );
      });

      // Restore current chat ID
      if (
        savedHistory.currentChatId &&
        this.chats.has(savedHistory.currentChatId)
      ) {
        this.currentChatId = savedHistory.currentChatId;
      } else if (this.chats.size > 0) {
        // Set to most recent chat if current not found
        this.currentChatId = Array.from(this.chats.keys())[this.chats.size - 1];
      } else {
        // Create new chat if none exist
        this.createNewChat();
      }
    } else {
      // Initialize with a new chat if no history exists
      this.createNewChat();
    }
  }
}
