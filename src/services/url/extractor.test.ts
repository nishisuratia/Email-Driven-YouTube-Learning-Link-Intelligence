import {
  extractYouTubeUrls,
  canonicalizeUrl,
  extractAndCanonicalize,
} from './extractor';

describe('URL Extractor', () => {
  describe('extractYouTubeUrls', () => {
    it('should extract youtube.com/watch URLs', () => {
      const text = 'Check out https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const urls = extractYouTubeUrls(text);
      expect(urls).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should extract youtu.be short URLs', () => {
      const text = 'Watch this: https://youtu.be/dQw4w9WgXcQ';
      const urls = extractYouTubeUrls(text);
      expect(urls).toContain('https://youtu.be/dQw4w9WgXcQ');
    });

    it('should extract multiple URLs', () => {
      const text = `
        First: https://www.youtube.com/watch?v=video1
        Second: https://youtu.be/video2
      `;
      const urls = extractYouTubeUrls(text);
      expect(urls.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract URLs without protocol', () => {
      const text = 'youtube.com/watch?v=dQw4w9WgXcQ';
      const urls = extractYouTubeUrls(text);
      expect(urls.length).toBeGreaterThan(0);
    });

    it('should extract playlist URLs', () => {
      const text = 'Playlist: https://www.youtube.com/playlist?list=PLxxx';
      const urls = extractYouTubeUrls(text);
      expect(urls.length).toBeGreaterThan(0);
    });
  });

  describe('canonicalizeUrl', () => {
    it('should canonicalize youtube.com/watch URL', () => {
      const result = canonicalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
      expect(result?.type).toBe('video');
    });

    it('should canonicalize youtu.be short URL', () => {
      const result = canonicalizeUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should remove tracking parameters', () => {
      const result = canonicalizeUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=email&utm_campaign=test&feature=youtu.be'
      );
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should preserve playlist parameter', () => {
      const result = canonicalizeUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx'
      );
      expect(result).not.toBeNull();
      expect(result?.playlistId).toBe('PLxxx');
      expect(result?.canonicalUrl).toContain('list=PLxxx');
    });

    it('should handle embed URLs', () => {
      const result = canonicalizeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should handle /v/ URLs', () => {
      const result = canonicalizeUrl('https://www.youtube.com/v/dQw4w9WgXcQ');
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result?.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should handle URLs without protocol', () => {
      const result = canonicalizeUrl('youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).not.toBeNull();
      expect(result?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should return null for invalid URLs', () => {
      const result = canonicalizeUrl('https://example.com/video');
      expect(result).toBeNull();
    });

    it('should return null for invalid video IDs', () => {
      const result = canonicalizeUrl('https://www.youtube.com/watch?v=short');
      expect(result).toBeNull();
    });

    it('should handle playlist-only URLs', () => {
      const result = canonicalizeUrl('https://www.youtube.com/playlist?list=PLxxx');
      expect(result).not.toBeNull();
      expect(result?.type).toBe('playlist');
      expect(result?.playlistId).toBe('PLxxx');
    });
  });

  describe('extractAndCanonicalize', () => {
    it('should deduplicate same video IDs', () => {
      const text = `
        https://www.youtube.com/watch?v=dQw4w9WgXcQ
        https://youtu.be/dQw4w9WgXcQ
        https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=test
      `;
      const results = extractAndCanonicalize(text);
      expect(results.length).toBe(1);
      expect(results[0].videoId).toBe('dQw4w9WgXcQ');
    });

    it('should handle multiple different videos', () => {
      const text = `
        https://www.youtube.com/watch?v=video1
        https://www.youtube.com/watch?v=video2
      `;
      const results = extractAndCanonicalize(text);
      expect(results.length).toBe(2);
    });

    it('should return empty array for no URLs', () => {
      const results = extractAndCanonicalize('No YouTube URLs here');
      expect(results.length).toBe(0);
    });
  });
});

