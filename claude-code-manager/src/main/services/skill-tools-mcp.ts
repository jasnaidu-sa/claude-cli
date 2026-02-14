/**
 * Skill Tools MCP Server - Tools available during skill execution
 *
 * Provides MCP tools that skills can use during execution:
 * - fetch_hn_stories: Fetch Hacker News top stories
 * - fetch_rss_feed: Fetch and parse an RSS feed
 * - get_project_statuses: Get git status of projects
 * - extract_url_content: Extract content from a URL
 * - categorize_idea: Categorize an idea text
 * - match_projects: Match idea to existing projects
 * - format_digest: Format digest data into a message
 * - format_idea_proposal: Format a processed idea
 *
 * These are injected as MCP tools when skills that require
 * 'digest-utils' or 'idea-utils' are executed.
 */

import { z } from 'zod'
import {
  fetchHNTopStories,
  fetchRSSFeed,
  getProjectStatuses,
  gatherDigestData,
  formatDigestMessage,
} from './digest-utilities'
import {
  extractUrlContent,
  categorizeIdea,
  matchProjectsByContent,
  extractUrls,
  formatIdeaProposal,
} from './idea-processor-utilities'
import type { DigestSource } from '@shared/skills-types'

type SDK = typeof import('@anthropic-ai/claude-agent-sdk')

/**
 * Create an MCP server with skill-specific tools.
 * Uses the Agent SDK's createSdkMcpServer + tool patterns.
 */
export function createSkillToolsMcpServer(
  sdk: SDK,
  digestSources: DigestSource[],
  projectPaths: string[],
): ReturnType<typeof sdk.createSdkMcpServer> {
  return sdk.createSdkMcpServer({
    name: 'skill-tools',
    tools: [
      // =====================================================================
      // Digest Tools
      // =====================================================================

      sdk.tool(
        'fetch_hn_stories',
        'Fetch top stories from Hacker News. Returns titles, scores, and URLs.',
        {
          max_items: z.number().min(1).max(30).default(10).describe('Maximum stories to return'),
          keywords: z.array(z.string()).optional().describe('Filter by keywords'),
        },
        async (args: { max_items: number; keywords?: string[] }) => {
          const { stories, errors } = await fetchHNTopStories(args.max_items, args.keywords)
          return JSON.stringify({
            stories: stories.map((s) => ({
              title: s.title,
              url: s.url,
              score: s.score,
              comments: s.descendants,
              by: s.by,
            })),
            count: stories.length,
            errors,
          })
        },
      ),

      sdk.tool(
        'fetch_rss_feed',
        'Fetch and parse an RSS or Atom feed. Returns items with title, link, and description.',
        {
          url: z.string().url().describe('RSS feed URL'),
          name: z.string().default('RSS').describe('Display name for the source'),
          max_items: z.number().min(1).max(20).default(5).describe('Maximum items'),
          keywords: z.array(z.string()).optional().describe('Filter by keywords'),
        },
        async (args: { url: string; name: string; max_items: number; keywords?: string[] }) => {
          const source: DigestSource = {
            name: args.name,
            url: args.url,
            type: 'rss',
            enabled: true,
          }
          const { items, errors } = await fetchRSSFeed(source, args.max_items, args.keywords)
          return JSON.stringify({ items, count: items.length, errors })
        },
      ),

      sdk.tool(
        'get_project_statuses',
        'Get git status and recent commits for known project directories.',
        {
          paths: z.array(z.string()).optional().describe('Project paths (uses defaults if empty)'),
        },
        async (args: { paths?: string[] }) => {
          const paths = args.paths?.length ? args.paths : projectPaths
          const { statuses, errors } = await getProjectStatuses(paths)
          return JSON.stringify({ projects: statuses, errors })
        },
      ),

      sdk.tool(
        'generate_digest',
        'Gather all digest data and format into a ready-to-send message.',
        {
          max_items_per_source: z.number().min(1).max(20).default(5),
          keywords: z.array(z.string()).optional(),
          include_projects: z.boolean().default(true),
        },
        async (args: { max_items_per_source: number; keywords?: string[]; include_projects: boolean }) => {
          const data = await gatherDigestData(
            digestSources,
            args.max_items_per_source,
            args.keywords,
            args.include_projects ? projectPaths : undefined,
          )
          const message = formatDigestMessage(data)
          return JSON.stringify({
            message,
            stats: {
              hnStories: data.hnStories.length,
              rssItems: data.rssItems.length,
              projects: data.projectStatuses.length,
              errors: data.errors.length,
            },
          })
        },
      ),

      // =====================================================================
      // Idea Processing Tools
      // =====================================================================

      sdk.tool(
        'extract_url_content',
        'Extract title, description, and main text content from a URL.',
        {
          url: z.string().url().describe('URL to extract content from'),
        },
        async (args: { url: string }) => {
          const content = await extractUrlContent(args.url)
          return JSON.stringify(content)
        },
      ),

      sdk.tool(
        'categorize_idea',
        'Categorize an idea as new_project, enhancement, learning, tool, or general.',
        {
          title: z.string().describe('Idea title'),
          description: z.string().default('').describe('Idea description'),
          user_message: z.string().optional().describe('Original user message'),
        },
        async (args: { title: string; description: string; user_message?: string }) => {
          const category = categorizeIdea(args.title, args.description, args.user_message)
          return JSON.stringify(category)
        },
      ),

      sdk.tool(
        'match_projects',
        'Find existing projects that match an idea based on keywords and content.',
        {
          idea_text: z.string().describe('Text describing the idea'),
          project_paths: z.array(z.string()).optional().describe('Override project paths'),
        },
        async (args: { idea_text: string; project_paths?: string[] }) => {
          const paths = args.project_paths?.length ? args.project_paths : projectPaths
          const matches = await matchProjectsByContent(args.idea_text, paths)
          return JSON.stringify(matches)
        },
      ),

      sdk.tool(
        'extract_urls_from_text',
        'Extract all URLs from a text message.',
        {
          text: z.string().describe('Text to extract URLs from'),
        },
        async (args: { text: string }) => {
          const urls = extractUrls(args.text)
          return JSON.stringify({ urls, count: urls.length })
        },
      ),

      sdk.tool(
        'format_idea_proposal',
        'Format a processed idea into a structured proposal message for the user.',
        {
          title: z.string(),
          summary: z.string(),
          category_type: z.enum(['new_project', 'enhancement', 'learning', 'tool', 'general']),
          tags: z.array(z.string()).default([]),
          url: z.string().optional(),
          project_matches: z.array(z.object({
            name: z.string(),
            relevance: z.number(),
            reason: z.string(),
          })).default([]),
        },
        async (args: {
          title: string
          summary: string
          category_type: string
          tags: string[]
          url?: string
          project_matches: Array<{ name: string; relevance: number; reason: string }>
        }) => {
          const idea = {
            content: args.url
              ? { url: args.url, title: args.title, description: '', content: '', wordCount: 0 }
              : null,
            category: {
              type: args.category_type as any,
              confidence: 0.8,
              tags: args.tags,
              suggestedTitle: args.title,
            },
            projectMatches: args.project_matches.map((m) => ({
              ...m,
              path: '',
              matchedKeywords: [],
            })),
            summary: args.summary,
            timestamp: Date.now(),
          }
          return formatIdeaProposal(idea)
        },
      ),
    ],
  })
}
