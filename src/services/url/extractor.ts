/**
 * URL Extractor & Canonicalizer
 * 
 * Extracts YouTube URLs from text and canonicalizes them to a standard format.
 * Handles:
 * - youtube.com/watch?v=...
 * - youtu.be/...
 * - youtube.com/playlist?list=...
 * - Removes tracking parameters (utm_*, etc.)
 * - Normalizes video IDs
 */

export interface CanonicalizedUrl {
  canonicalUrl: string;
  videoId: string;
  playlistId?: string;
  type: 'video' | 'playlist' | 'channel';
}

// YouTube URL patterns
const YOUTUBE_PATTERNS = {
  // youtube.com/watch?v=VIDEO_ID
  watch: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/gi,
  
  // youtu.be/VIDEO_ID
  short: /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/gi,
  
  // youtube.com/embed/VIDEO_ID
  embed: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/gi,
  
  // youtube.com/v/VIDEO_ID
  v: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/gi,
  
  // youtube.com/playlist?list=PLAYLIST_ID
  playlist: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/gi,
  
  // youtube.com/watch?v=VIDEO_ID&list=PLAYLIST_ID
  watchWithPlaylist: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*?v=([a-zA-Z0-9_-]{11}).*?list=([a-zA-Z0-9_-]+)/gi,
};

/**
 * Extract all YouTube URLs from text
 */
export function extractYouTubeUrls(text: string): string[] {
  const urls = new Set<string>();
  
  // Match all patterns
  Object.values(YOUTUBE_PATTERNS).forEach((pattern) => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[0]) {
        urls.add(match[0]);
      }
    }
  });
  
  return Array.from(urls);
}

/**
 * Canonicalize a YouTube URL to standard format
 * 
 * Returns:
 * - canonicalUrl: youtube.com/watch?v=VIDEO_ID (for videos)
 * - videoId: extracted video ID
 * - playlistId: optional playlist ID
 */
export function canonicalizeUrl(url: string): CanonicalizedUrl | null {
  // Normalize: add https:// if missing, lowercase domain
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  
  try {
    const urlObj = new URL(normalized);
    
    // Handle youtu.be short links
    if (urlObj.hostname === 'youtu.be' || urlObj.hostname === 'www.youtu.be') {
      const videoId = urlObj.pathname.substring(1); // Remove leading /
      if (isValidVideoId(videoId)) {
        return {
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          type: 'video',
        };
      }
    }
    
    // Handle youtube.com URLs
    if (urlObj.hostname === 'youtube.com' || urlObj.hostname === 'www.youtube.com') {
      // Check for playlist-only URL
      if (urlObj.pathname === '/playlist' && urlObj.searchParams.has('list')) {
        const playlistId = urlObj.searchParams.get('list')!;
        return {
          canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
          videoId: '', // No video in playlist-only URL
          playlistId,
          type: 'playlist',
        };
      }
      
      // Check for watch URL with video ID
      if (urlObj.pathname === '/watch' && urlObj.searchParams.has('v')) {
        const videoId = urlObj.searchParams.get('v')!;
        const playlistId = urlObj.searchParams.get('list') || undefined;
        
        if (isValidVideoId(videoId)) {
          // Remove all tracking parameters, keep only v and optionally list
          const cleanParams = new URLSearchParams();
          cleanParams.set('v', videoId);
          if (playlistId) {
            cleanParams.set('list', playlistId);
          }
          
          return {
            canonicalUrl: `https://www.youtube.com/watch?${cleanParams.toString()}`,
            videoId,
            playlistId,
            type: playlistId ? 'playlist' : 'video',
          };
        }
      }
      
      // Check for embed URL
      if (urlObj.pathname.startsWith('/embed/')) {
        const videoId = urlObj.pathname.substring(7); // Remove /embed/
        if (isValidVideoId(videoId)) {
          return {
            canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            type: 'video',
          };
        }
      }
      
      // Check for /v/ URL
      if (urlObj.pathname.startsWith('/v/')) {
        const videoId = urlObj.pathname.substring(3); // Remove /v/
        if (isValidVideoId(videoId)) {
          return {
            canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            type: 'video',
          };
        }
      }
    }
  } catch (error) {
    // Invalid URL
    return null;
  }
  
  return null;
}

/**
 * Validate YouTube video ID format
 * YouTube video IDs are exactly 11 characters: [a-zA-Z0-9_-]
 */
function isValidVideoId(videoId: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

/**
 * Extract and canonicalize all YouTube URLs from text
 * Returns deduplicated canonicalized URLs
 */
export function extractAndCanonicalize(text: string): CanonicalizedUrl[] {
  const urls = extractYouTubeUrls(text);
  const canonicalized = new Map<string, CanonicalizedUrl>();
  
  for (const url of urls) {
    const canonical = canonicalizeUrl(url);
    if (canonical && canonical.videoId) {
      // Deduplicate by videoId (ignore playlist differences for dedup)
      const key = canonical.videoId;
      if (!canonicalized.has(key)) {
        canonicalized.set(key, canonical);
      }
    }
  }
  
  return Array.from(canonicalized.values());
}

