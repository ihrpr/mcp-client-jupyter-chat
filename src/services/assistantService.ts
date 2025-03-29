import Anthropic from '@anthropic-ai/sdk';
import { IStateDB } from '@jupyterlab/statedb';
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  IStreamEvent,
  INotebookContext,
  ITokenUsage,
  ISerializedHistory,
  IChat,
  StateDBValue,
  ISerializedContentBlock,
  MessageList
} from '../types';
import { generateChatId, generateChatTitle } from '../utils';
import { McpService } from './mcpService';

/**
 * Service for managing the assistant and conversations
 */
export class AssistantService {
  private readonly TOKEN_BUDGET: number = 20000;
  private readonly THINKING_TOKEN_BUDGET: number = 16000;
  private chats: Map<string, Anthropic.Messages.MessageParam[]> = new Map();
  private chatTokenUsage: Map<string, ITokenUsage> = new Map();
  private currentChatId: string | null = null;
  private anthropic: Anthropic;
  private modelName: string;
  private stateDB: IStateDB;
  private readonly stateKey: string = 'mcp-chat:conversation-history';
  private mcpService: McpService;

  constructor(
    mcpService: McpService,
    modelName: string,
    apiKey: string,
    stateDB: IStateDB
  ) {
    this.mcpService = mcpService;
    this.anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.modelName = modelName;
    this.stateDB = stateDB;
    this.loadHistory();
  }

  /**
   * Get tools for a specific server
   */
  getServerTools(serverName: string): McpTool[] {
    return this.mcpService.getServerTools(serverName);
  }

  /**
   * Get all chats
   */
  getChats(): { id: string; title: string; createdAt: string }[] {
    return Array.from(this.chats.entries())
      .map(([id, messages]) => ({
        id,
        title: generateChatTitle(messages),
        createdAt: id.split('-')[1] // Extract timestamp from ID
      }))
      .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt)); // Sort by creation time, newest first
  }

  /**
   * Get the current chat messages
   */
  getCurrentChat(): MessageList {
    return this.currentChatId ? this.chats.get(this.currentChatId) || [] : [];
  }

  /**
   * Get token usage for the current chat
   */
  getCurrentChatTokenUsage(): ITokenUsage {
    return this.currentChatId
      ? this.chatTokenUsage.get(this.currentChatId) || {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          thinking_tokens: 0
        }
      : {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          thinking_tokens: 0
        };
  }

  /**
   * Create a new chat
   */
  createNewChat(): string {
    const chatId = generateChatId();
    this.chats.set(chatId, []);
    this.chatTokenUsage.set(chatId, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      thinking_tokens: 0
    });
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
    const mcpClients = this.mcpService.getClients();

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
        let thinkingDelta = '';
        let signatureDelta = '';
        let currentToolName = '';
        let redactedThinking = '';
        let currentToolID = '';
        keepProcessing = false;

        const toolSeparator = this.mcpService.getToolSeparator();
        const tools: Anthropic.Messages.Tool[] = Array.from(
          this.mcpService.getAllTools().entries()
        ).flatMap(([serverName, tools]) =>
          tools.map(tool => ({
            name: `${serverName}${toolSeparator}${tool.name}`,
            description: tool.description,
            input_schema: tool.inputSchema
          }))
        );
        // add cache to the last tool
        tools[tools.length - 1].cache_control = { type: 'ephemeral' };

        // Clone messages and add cache control to last message
        const clonedMessagesWithCacheControl = [...currentMessages];
        if (clonedMessagesWithCacheControl.length > 0) {
          const lastMessageIndex = clonedMessagesWithCacheControl.length - 1;
          const lastMessage = clonedMessagesWithCacheControl[lastMessageIndex];
          if (typeof lastMessage.content === 'string') {
            const lastText = lastMessage.content;
            clonedMessagesWithCacheControl[lastMessageIndex] = {
              ...lastMessage,
              content: [
                {
                  type: 'text',
                  text: lastText,
                  cache_control: { type: 'ephemeral' }
                }
              ]
            };
          }
        }

        // Create streaming request to Claude
        const stream = this.anthropic.beta.messages.stream({
          model: this.modelName,
          max_tokens: this.TOKEN_BUDGET,
          thinking: {
            type: 'enabled',
            budget_tokens: this.THINKING_TOKEN_BUDGET
          },
          betas: ['output-128k-2025-02-19'],
          messages: clonedMessagesWithCacheControl,
          tools: tools,
          system: `
You are an advanced AI assistant specializing in data science, machile learning, artificial intelligence, and software engineering. Your primary function is to assist users with creating and modifying Jupyter notebooks. Your expertise spans across various aspects of these fields, including but not limited to:

- Data analysis and visualization
- Machine learning algorithms and implementations
- Deep learning frameworks
- Statistical modeling
- Python programming
- Jupyter notebook best practices
- Version control for data science projects
- Big data processing
- Natural language processing
- Computer vision

When responding to user queries, always maintain a professional and helpful demeanor. Your goal is to provide clear, concise, and accurate information that directly addresses the user's needs.

Before providing your final response, please analyze the task in detail. Conduct your task breakdown inside <task_breakdown> tags in your thinking block. Consider the following:

1. What specific area(s) of expertise does this task require? List them out.
2. Are there any potential challenges or complexities in the task that need to be addressed? Enumerate them.
3. What additional information, if any, might be needed to fully assist the user? Be specific.
4. What libraries or tools might be necessary for this task? List them.
5. Based on the task description, what is the likely level of expertise of the user? Provide reasoning.
6. Identify and list the key components of the task.

After your analysis, provide your assistance in the following format:

1. Task Summary: A very brief restatement of the user's task to ensure understanding.
2. Approach: Outline the steps or methodology you recommend for tackling the task.
3. Implementation: use tools to manipulate notebook and add/modify implementation.
4. Use tools to verify the implementation by executing cells and fix any issues.
5. Additional Considerations: Mention any best practices, potential pitfalls, or optimization tips relevant to the task.

Your final output should consist only of the assistance in the format specified above and should not duplicate or rehash any of the work you did in the task breakdown section.`
        });

        // Process the stream
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              currentToolName = event.content_block.name;
              currentToolID = event.content_block.id;

              // Immediately emit tool_use event to show in UI
              yield {
                type: 'tool_use',
                name: currentToolName,
                input: {} // Empty input initially, will be filled with streaming data
              };
            } else if (event.content_block.type === 'redacted_thinking') {
              redactedThinking = event.content_block.data;
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'thinking_delta') {
              thinkingDelta += event.delta.thinking;
              // Yield thinking_delta event for UI to display
              yield {
                type: 'thinking_delta',
                thinking: event.delta.thinking,
                thinking_complete: false
              };
            } else if (event.delta.type === 'signature_delta') {
              signatureDelta += event.delta.signature;
            } else if (event.delta.type === 'text_delta') {
              textDelta += event.delta.text;
              // If we had thinking and now getting text, mark thinking as complete
              if (thinkingDelta !== '') {
                yield {
                  type: 'thinking_delta',
                  thinking: '',
                  thinking_complete: true
                };
              }
              yield {
                type: 'text',
                text: event.delta.text
              };
            } else if (event.delta.type === 'input_json_delta') {
              jsonDelta += event.delta.partial_json;

              // Stream ONLY the new fragment to be more efficient
              yield {
                type: 'input_json_delta',
                name: currentToolName,
                partial_json: event.delta.partial_json
              };
            }
          } else if (event.type === 'message_delta') {
            if (event.delta.stop_reason === 'tool_use') {
              keepProcessing = true;
              if (currentToolName !== '') {
                const content: Anthropic.ContentBlockParam[] = [];
                if (thinkingDelta !== '') {
                  content.push({
                    type: 'thinking',
                    thinking: thinkingDelta,
                    signature: signatureDelta
                  } as Anthropic.ThinkingBlockParam);
                }
                if (redactedThinking !== '') {
                  content.push({
                    type: 'redacted_thinking',
                    data: redactedThinking
                  } as Anthropic.RedactedThinkingBlockParam);
                }

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
                  const [serverName, toolName] =
                    currentToolName.split(toolSeparator);
                  const client = mcpClients.get(serverName);

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
                  thinkingDelta = '';
                  signatureDelta = '';
                  redactedThinking = '';
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
        console.log(
          'Final message:',
          finalMessage.usage?.cache_creation_input_tokens,
          finalMessage.usage?.cache_read_input_tokens,
          finalMessage.usage?.input_tokens,
          finalMessage.usage?.output_tokens
        );

        // Update token usage for the current chat
        if (this.currentChatId && finalMessage.usage) {
          const currentUsage = this.chatTokenUsage.get(this.currentChatId) || {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          };

          this.chatTokenUsage.set(this.currentChatId, {
            input_tokens:
              currentUsage.input_tokens +
              (finalMessage.usage.input_tokens || 0),
            output_tokens:
              currentUsage.output_tokens +
              (finalMessage.usage.output_tokens || 0),
            cache_creation_input_tokens:
              currentUsage.cache_creation_input_tokens +
              (finalMessage.usage.cache_creation_input_tokens || 0),
            cache_read_input_tokens:
              currentUsage.cache_read_input_tokens +
              (finalMessage.usage.cache_read_input_tokens || 0)
          });

          await this.saveHistory();
        }
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
        title: generateChatTitle(messages),
        createdAt: id.split('-')[1],
        tokenUsage: this.chatTokenUsage.get(id) || {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        },
        messages: messages.map(msg => {
          const serializedContent = Array.isArray(msg.content)
            ? msg.content.map(
                (
                  block: Anthropic.ContentBlockParam
                ): ISerializedContentBlock => {
                  if ('text' in block) {
                    return { type: 'text', text: block.text };
                  }

                  // Handle thinking blocks specially
                  if (block.type === 'thinking') {
                    return {
                      type: 'thinking',
                      thinking: block.thinking,
                      signature: block.signature
                    };
                  }

                  // Handle tool use blocks specially
                  if (block.type === 'tool_use') {
                    return {
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      input: JSON.parse(JSON.stringify(block.input))
                    };
                  }

                  // Handle tool result blocks specially
                  if (block.type === 'tool_result') {
                    return {
                      type: 'tool_result',
                      tool_use_id: block.tool_use_id,
                      content: JSON.parse(JSON.stringify(block.content))
                    };
                  }

                  // Convert complex types to a serializable format for other block types
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
                          acc[key] = JSON.parse(JSON.stringify(value)) as any;
                        }
                        return acc;
                      },
                      {} as Record<string, any>
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

    // Convert to JSON-compatible structure
    const history = {
      chats: JSON.parse(JSON.stringify(serializedChats)),
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
        chats: savedData.chats as IChat[],
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
                  } else if (block.type === 'thinking') {
                    return {
                      type: 'thinking',
                      thinking: block.thinking,
                      signature: block.signature
                    } as Anthropic.ThinkingBlockParam;
                  } else if (block.type === 'tool_use') {
                    return {
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      input: block.input
                    } as Anthropic.ToolUseBlockParam;
                  } else if (block.type === 'tool_result') {
                    return {
                      type: 'tool_result',
                      tool_use_id: block.tool_use_id,
                      content: block.content
                    } as Anthropic.ToolResultBlockParam;
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

        // Restore token usage for this chat
        if (chat.tokenUsage) {
          this.chatTokenUsage.set(chat.id, chat.tokenUsage);
        } else {
          this.chatTokenUsage.set(chat.id, {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          });
        }
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
