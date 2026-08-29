/**
 * Video & Subtitle User Preferences
 */

export interface SubtitleSettings {
  /** If a video has subtitles, whether to display them by default locally */
  showByDefault: boolean;
  /** 'outline' (text stroke outline) vs 'background' (semi-transparent pill) */
  styleMode: 'outline' | 'background';
  /** Background pill color in hex format (e.g. '#000000', '#0f172a') */
  bgColor: string;
  /** Background pill opacity from 0.0 to 1.0 */
  bgOpacity: number;
  /** Text stroke outline color in hex or rgba format */
  outlineColor: string;
  /** Text stroke outline thickness: 'thin' (12%), 'medium' (22%), 'thick' (36%) */
  outlineThickness: 'thin' | 'medium' | 'thick';
  /** Subtitle font size scale: 0.8 (small), 1.0 (normal), 1.2 (large) */
  fontScale: number;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  showByDefault: true,
  styleMode: 'outline',
  bgColor: '#000000',
  bgOpacity: 0.84,
  outlineColor: '#000000',
  outlineThickness: 'medium',
  fontScale: 1.0,
};

const LOCAL_STORAGE_KEY = 'nexusvr_subtitle_settings';

/**
 * Load saved subtitle settings from localStorage, or return defaults.
 */
export function loadSubtitleSettings(): SubtitleSettings {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SUBTITLE_SETTINGS,
        ...parsed,
      };
    }
  } catch (e) {
    console.warn('[SubtitleSettings] Failed to load from localStorage:', e);
  }
  return { ...DEFAULT_SUBTITLE_SETTINGS };
}

/**
 * Save subtitle settings to localStorage.
 */
export function saveSubtitleSettings(settings: SubtitleSettings): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[SubtitleSettings] Failed to save to localStorage:', e);
  }
}
