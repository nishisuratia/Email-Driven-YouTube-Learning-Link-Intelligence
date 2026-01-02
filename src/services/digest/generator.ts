import Handlebars from 'handlebars';
import { query } from '../../db/connection';
import { logger } from '../../utils/logger';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface DigestOptions {
  userId: string;
  type: 'daily' | 'weekly';
  date: Date;
  outputPath?: string;
}

export interface DigestData {
  userEmail: string;
  date: string;
  watchNow: any[];
  save: any[];
  skip: any[];
  totalLinks: number;
}

/**
 * Digest Generator Service
 * 
 * Generates daily/weekly HTML digests with ranked links
 */
export class DigestGenerator {
  private template: HandlebarsTemplateDelegate;

  constructor() {
    // Load HTML template
    const templatePath = join(__dirname, '../../templates/digest.hbs');
    try {
      const templateSource = readFileSync(templatePath, 'utf-8');
      this.template = Handlebars.compile(templateSource);
    } catch (error) {
      // Fallback template if file doesn't exist
      this.template = Handlebars.compile(this.getDefaultTemplate());
    }
  }

  /**
   * Generate digest for user
   */
  async generateDigest(options: DigestOptions): Promise<string> {
    const { userId, type, date, outputPath } = options;
    const digestLogger = logger.child({ userId, type });

    try {
      // Get user email
      const user = await query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [userId]
      );

      if (user.length === 0) {
        throw new Error(`User not found: ${userId}`);
      }

      const userEmail = user[0].email;

      // Calculate date range
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      if (type === 'weekly') {
        endDate.setDate(endDate.getDate() + 7);
      } else {
        endDate.setDate(endDate.getDate() + 1);
      }

      // Fetch rankings
      const rankings = await query(
        `
        SELECT
          r.final_score,
          r.classification,
          r.explanation,
          r.topic_tags,
          yl.canonical_url,
          vm.title,
          vm.channel_title,
          vm.thumbnail_url,
          vm.duration_seconds,
          vm.published_at,
          e.sender_email,
          e.sender_name,
          e.subject
        FROM rankings r
        JOIN youtube_links yl ON r.link_id = yl.id
        JOIN video_metadata vm ON r.video_id = vm.video_id
        JOIN emails e ON yl.email_id = e.id
        WHERE r.user_id = $1
          AND r.ranked_at >= $2
          AND r.ranked_at < $3
        ORDER BY r.final_score DESC
        `,
        [userId, startDate, endDate]
      );

      // Group by classification
      const watchNow = rankings.filter((r) => r.classification === 'watch_now').slice(0, 10);
      const save = rankings.filter((r) => r.classification === 'save').slice(0, 20);
      const skip = rankings.filter((r) => r.classification === 'skip');

      const digestData: DigestData = {
        userEmail,
        date: date.toISOString().split('T')[0],
        watchNow,
        save,
        skip,
        totalLinks: rankings.length,
      };

      // Generate HTML
      const html = this.template(digestData);

      // Write to file if output path provided
      if (outputPath) {
        writeFileSync(outputPath, html, 'utf-8');
        digestLogger.info('Digest generated', { outputPath, totalLinks: rankings.length });
      }

      return html;
    } catch (error) {
      digestLogger.error('Failed to generate digest', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Default HTML template (fallback)
   */
  private getDefaultTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>YouTube Content Digest - {{date}}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    .video { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
    .video-title { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
    .video-channel { color: #666; margin-bottom: 5px; }
    .video-explanation { color: #888; font-size: 14px; margin-top: 10px; }
    .watch-now { border-left: 4px solid #4CAF50; }
    .save { border-left: 4px solid #FF9800; }
    .skip { border-left: 4px solid #f44336; opacity: 0.7; }
    a { color: #1976D2; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>YouTube Content Digest - {{date}}</h1>
  <p>Hello {{userEmail}},</p>
  <p>Here are your ranked YouTube links from the past {{#if (eq type "weekly")}}week{{else}}day{{/if}}:</p>

  <h2>Watch Now (Top {{watchNow.length}})</h2>
  {{#each watchNow}}
  <div class="video watch-now">
    <div class="video-title"><a href="{{canonical_url}}" target="_blank">{{title}}</a></div>
    <div class="video-channel">{{channel_title}}</div>
    <div class="video-explanation">{{explanation}}</div>
  </div>
  {{/each}}

  <h2>Save for Later ({{save.length}})</h2>
  {{#each save}}
  <div class="video save">
    <div class="video-title"><a href="{{canonical_url}}" target="_blank">{{title}}</a></div>
    <div class="video-channel">{{channel_title}}</div>
    <div class="video-explanation">{{explanation}}</div>
  </div>
  {{/each}}

  <h2>Skip ({{skip.length}})</h2>
  <details>
    <summary>Show skipped links ({{skip.length}})</summary>
    {{#each skip}}
    <div class="video skip">
      <div class="video-title"><a href="{{canonical_url}}" target="_blank">{{title}}</a></div>
      <div class="video-channel">{{channel_title}}</div>
    </div>
    {{/each}}
  </details>

  <p><small>Total links processed: {{totalLinks}}</small></p>
</body>
</html>
    `;
  }
}

