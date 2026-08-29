/**
 * SRT and WebVTT Subtitle Parser
 *
 * Supports SubRip (.srt) and WebVTT (.vtt) file formats.
 * Converts raw subtitle text into an array of timed SubtitleCue objects.
 */

export interface SubtitleCue {
  start: number; // Start time in seconds
  end: number;   // End time in seconds
  text: string;  // Subtitle text content
  _wrappedLines?: string[];
  _rectWidth?: number;
  _rectHeight?: number;
  _wrappedWidth?: number;
  /** Font pixel size the cached `_wrappedLines` were laid out for. */
  _wrapFontPx?: number;
}

/**
 * Convert HH:MM:SS,mmm or MM:SS.mmm string into seconds.
 */
function parseTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const cleanStr = timeStr.trim().split(/\s+/)[0].replace(',', '.');
  const parts = cleanStr.split(':');
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  } else if (parts.length === 1) {
    return parseFloat(parts[0]) || 0;
  }
  return 0;
}

/**
 * Parse raw SRT, WebVTT, or bracketed timestamp content into an array of SubtitleCue objects.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  if (!content || !content.trim()) return [];

  // Normalize line endings and strip UTF-8 BOM
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const cues: SubtitleCue[] = [];

  let currentStart = -1;
  let currentEnd = -1;
  let currentTextLines: string[] = [];

  const flushCue = () => {
    if (currentStart >= 0 && currentEnd >= currentStart && currentTextLines.length > 0) {
      const text = currentTextLines.join('\n').replace(/<[^>]*>/g, '').trim();
      if (text) {
        cues.push({ start: currentStart, end: currentEnd, text });
      }
    }
    currentStart = -1;
    currentEnd = -1;
    currentTextLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line && currentStart < 0) continue;

    // Check bracket timestamp format e.g. [00:05.00] or [01:23] Subtitle text
    const bracketMatch = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?(?:[\.,]\d+)?)\]\s*(.+)$/);
    if (bracketMatch) {
      flushCue();
      currentStart = parseTimestamp(bracketMatch[1]);
      currentEnd = currentStart + 4.0;
      currentTextLines = [bracketMatch[2]];
      flushCue();
      continue;
    }

    if (line.includes('-->')) {
      // Found a timestamp line, flush previous cue first
      flushCue();
      const parts = line.split('-->');
      if (parts.length >= 2) {
        currentStart = parseTimestamp(parts[0]);
        currentEnd = parseTimestamp(parts[1]);
      }
    } else if (currentStart >= 0) {
      // If we are accumulating text for a cue
      if (!line) {
        // Empty line ends the cue text block
        flushCue();
      } else if (/^\d+$/.test(line) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
        // Next line is a timestamp line, so this line is the sequence number for the NEXT cue
        flushCue();
      } else {
        currentTextLines.push(line);
      }
    }
  }

  flushCue();
  return cues.sort((a, b) => a.start - b.start);
}
