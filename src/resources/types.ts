export interface YouTubeVideoItem {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  channel: string;
  views?: string;
  published?: string;
}

export interface BlogItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  readingTime?: string;
  reactions?: string;
}

export interface ResearchArtifactItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  authors?: string;
  year?: string;
}

export type ResearchToolName = 'search_youtube' | 'search_blogs' | 'search_arxiv';

export interface ResearchToolCall {
  tool: ResearchToolName;
  query: string;
}

export interface GemmaResearchPlan {
  tool_calls: ResearchToolCall[];
}

export interface TaskResourcesResult {
  taskId: string;
  query: string;
  tier: 'intelligent' | 'keyword';
  notice?: string;
  videos: YouTubeVideoItem[];
  blogs: BlogItem[];
  artifacts: ResearchArtifactItem[];
}
