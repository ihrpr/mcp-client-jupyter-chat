import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import Anthropic from '@anthropic-ai/sdk';

// Model configurations
export interface IModelConfig {
  name: string;
  apiKey: string;
  isDefault: boolean;
}

// MCP server configurations
export interface IMcpServerConfig {
  name: string;
  url: string;
}

// App settings
export interface ISettings {
  models: IModelConfig[];
  mcpServers: IMcpServerConfig[];
}

// Content blocks for UI rendering
export interface IContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  thinking_complete?: boolean;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | any;
  is_error?: boolean;
}

// Notebook context for sending to assistant
export interface INotebookContext {
  notebookPath?: string;
  activeCellID?: string;
}

// Token usage tracking
export interface ITokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  thinking_tokens?: number;
  [key: string]: number | undefined; // For compatibility with JSONValue
}

// Chat information
export interface IChat {
  id: string;
  title: string;
  messages: ISerializedMessage[];
  createdAt: string;
  tokenUsage: ITokenUsage;
}

// Message serialization interfaces
export interface ISerializedContentBlock {
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

export interface ISerializedMessage {
  role: string;
  content: string | ISerializedContentBlock[];
  [key: string]: string | ISerializedContentBlock[] | undefined;
}

export interface ISerializedHistory {
  chats: IChat[];
  currentChatId?: string;
}

// Stream events for UI updates
export interface IStreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking_delta';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
  thinking?: string;
  thinking_complete?: boolean;
}

// JSON type definitions
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];

// Type for JupyterLab state database values
export type StateDBValue = { [key: string]: JSONValue };

// McpClient type
export type McpClientMap = Map<string, Client>;

// Tool type
export type McpToolMap = Map<string, McpTool[]>;

// Message type
export type MessageList = Anthropic.Messages.MessageParam[];
