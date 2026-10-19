import { BlogItem, GemmaResearchPlan, ResearchArtifactItem, YouTubeVideoItem } from './types';

function cleanQuery(text: string): string {
  return text
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function truncate(text: string, maxLen = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen - 1)}…`;
}

/**
 * Baton Research Tool: YouTube Search Scraper
 * Searches YouTube for video tutorials, walk-throughs, and technical explanations.
 */
export async function searchYouTubeKeywords(query: string): Promise<YouTubeVideoItem[]> {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleaned)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (response.ok) {
      const html = await response.text();
      const match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (match) {
        const data = JSON.parse(match[1]) as {
          contents?: {
            twoColumnSearchResultsRenderer?: {
              primaryContents?: {
                sectionListRenderer?: {
                  contents?: Array<{
                    itemSectionRenderer?: {
                      contents?: Array<{
                        videoRenderer?: {
                          videoId: string;
                          title?: { runs?: Array<{ text: string }> };
                          ownerText?: { runs?: Array<{ text: string }> };
                          viewCountText?: { simpleText?: string };
                          publishedTimeText?: { simpleText?: string };
                        };
                      }>;
                    };
                  }>;
                };
              };
            };
          };
        };

        const sectionContents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;

        if (Array.isArray(sectionContents)) {
          const found: YouTubeVideoItem[] = [];
          for (const item of sectionContents) {
            if (!item.videoRenderer || !item.videoRenderer.videoId) continue;
            const vr = item.videoRenderer;
            const id = vr.videoId;
            const title = vr.title?.runs?.[0]?.text?.trim() || 'Video Tutorial';
            const channel = vr.ownerText?.runs?.[0]?.text?.trim() || 'YouTube Creator';
            const views = vr.viewCountText?.simpleText?.trim();
            const published = vr.publishedTimeText?.simpleText?.trim();

            found.push({
              id,
              title,
              url: `https://www.youtube.com/watch?v=${id}`,
              thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              channel,
              views,
              published,
            });
            if (found.length >= 3) break;
          }
          if (found.length > 0) return found;
        }
      }
    }
  } catch {
    // Fall back to direct search card
  }

  return [
    {
      id: 'search',
      title: `Search YouTube: "${cleaned}"`,
      url,
      thumbnailUrl: 'https://www.youtube.com/img/desktop/yt_1200.png',
      channel: 'YouTube Search',
      views: 'Search results',
    },
  ];
}

/**
 * Baton Research Tool: Developer Articles & Blogs Search
 * Queries Dev.to and Hacker News APIs for technical engineering guides.
 */
export async function searchBlogsKeywords(query: string): Promise<BlogItem[]> {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const results: BlogItem[] = [];

  // 1. Dev.to API
  try {
    const devToUrl = `https://dev.to/api/articles?q=${encodeURIComponent(cleaned)}&per_page=3`;
    const res = await fetch(devToUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const items = (await res.json()) as Array<{
        title: string;
        url: string;
        description?: string;
        reading_time_minutes?: number;
        public_reactions_count?: number;
      }>;
      for (const item of items) {
        if (!item.title || !item.url) continue;
        results.push({
          title: item.title,
          url: item.url,
          source: 'dev.to',
          snippet: truncate(item.description || item.title),
          readingTime: item.reading_time_minutes ? `${item.reading_time_minutes} min read` : undefined,
          reactions: item.public_reactions_count ? `${item.public_reactions_count} reactions` : undefined,
        });
        if (results.length >= 3) break;
      }
    }
  } catch {
    // Continue
  }

  // 2. Hacker News Algolia API fallback
  if (results.length < 3) {
    try {
      const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(cleaned)}&tags=story&hitsPerPage=4`;
      const res = await fetch(hnUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = (await res.json()) as {
          hits?: Array<{
            title: string;
            url?: string;
            points?: number;
            author?: string;
            objectID: string;
          }>;
        };
        for (const hit of data.hits || []) {
          const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
          let hostname = 'news.ycombinator.com';
          try {
            hostname = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            // keep default
          }
          if (results.some((r) => r.url === url)) continue;
          results.push({
            title: hit.title,
            url,
            source: hostname,
            snippet: `Discussed on Hacker News by ${hit.author || 'community'}.`,
            reactions: hit.points ? `${hit.points} points` : undefined,
          });
          if (results.length >= 3) break;
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!results.length) {
    results.push({
      title: `Developer Guides for "${cleaned}"`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(cleaned + ' developer guide tutorial')}`,
      source: 'DuckDuckGo',
      snippet: `Explore engineering articles and community guides for "${cleaned}".`,
    });
  }

  return results.slice(0, 3);
}

/**
 * Baton Research Tool: Academic Papers & Specs (arXiv & Google Scholar)
 * Queries the official arXiv API for preprints, algorithms, and models.
 */
export async function searchResearchKeywords(query: string): Promise<ResearchArtifactItem[]> {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const results: ResearchArtifactItem[] = [];

  // Simplify arXiv query to key terms (arXiv API performs best with concise keyword sets)
  const arxivKeywords = cleaned.split(/\s+/).slice(0, 5).join(' ');

  try {
    const arxivUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(arxivKeywords)}&start=0&max_results=3`;
    const res = await fetch(arxivUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const xml = await res.text();
      const entries = xml.split(/<entry[\s>]/).slice(1);
      for (const entry of entries) {
        const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
        const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
        const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
        const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);
        const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim());

        const rawTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
        const id = idMatch ? idMatch[1].trim() : '';
        if (!rawTitle || !id) continue;

        const year = publishedMatch ? publishedMatch[1].slice(0, 4) : undefined;
        const authorText = authors.length > 2 ? `${authors.slice(0, 2).join(', ')} et al.` : authors.join(', ');

        results.push({
          title: rawTitle,
          url: id,
          source: 'arXiv',
          summary: truncate(summaryMatch ? summaryMatch[1] : 'Academic research paper on arXiv.'),
          authors: authorText || undefined,
          year,
        });
        if (results.length >= 3) break;
      }
    }
  } catch {
    // Continue to scholarly fallback
  }

  if (!results.length) {
    results.push({
      title: `arXiv Research: ${cleaned}`,
      url: `https://arxiv.org/search/?query=${encodeURIComponent(cleaned)}&searchtype=all`,
      source: 'arXiv Search',
      summary: `Search scholarly papers, models, and specifications for "${cleaned}".`,
    });
  }

  return results.slice(0, 3);
}

/**
 * Execute Baton's research tools according to a plan initiated by Gemma or fallback rules.
 */
export async function executeResearchPlan(plan: GemmaResearchPlan): Promise<{
  videos: YouTubeVideoItem[];
  blogs: BlogItem[];
  artifacts: ResearchArtifactItem[];
}> {
  const ytCall = plan.tool_calls.find((c) => c.tool === 'search_youtube');
  const blogCall = plan.tool_calls.find((c) => c.tool === 'search_blogs');
  const arxivCall = plan.tool_calls.find((c) => c.tool === 'search_arxiv');

  const [videos, blogs, artifacts] = await Promise.all([
    ytCall ? searchYouTubeKeywords(ytCall.query) : Promise.resolve([]),
    blogCall ? searchBlogsKeywords(blogCall.query) : Promise.resolve([]),
    arxivCall ? searchResearchKeywords(arxivCall.query) : Promise.resolve([]),
  ]);

  return { videos, blogs, artifacts };
}

/**
 * Fallback plan generator when Gemma is unavailable or unconfigured.
 */
export function fallbackResearchPlan(task: string): GemmaResearchPlan {
  const clean = cleanQuery(task);
  return {
    tool_calls: [
      { tool: 'search_youtube', query: `${clean} tutorial` },
      { tool: 'search_blogs', query: `${clean} guide` },
      { tool: 'search_arxiv', query: clean },
    ],
  };
}

/**
 * Default direct keyword pipeline for backwards compatibility.
 */
export async function searchKeywordPipeline(query: string): Promise<{
  videos: YouTubeVideoItem[];
  blogs: BlogItem[];
  artifacts: ResearchArtifactItem[];
}> {
  return executeResearchPlan(fallbackResearchPlan(query));
}
