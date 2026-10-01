/**
 * Anthropic Messages API content blocks as they appear in transcript entries.
 */

type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

interface BaseContent {
  type: ContentType;
}

export interface TextContent extends BaseContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent extends BaseContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseContent extends BaseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent extends BaseContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageContent extends BaseContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

export function isTextContent(content: ContentBlock): content is TextContent {
  return content.type === 'text';
}

export function isToolResultContent(content: ContentBlock): content is ToolResultContent {
  return content.type === 'tool_result';
}
