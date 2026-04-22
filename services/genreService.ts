/**
 * Genre Service — manages music genre playlists with scheduled time slots
 */

import { MediaFile } from '../types';

export type GenreName =
  | 'Afrobeats' | 'Amapiano' | 'R&B' | 'Hip-Hop' | 'Gospel'
  | 'Highlife' | 'Reggae' | 'Jazz' | 'Pop' | 'Dancehall'
  | 'Fuji' | 'Juju' | 'Soul' | 'Electronic' | 'General';

export interface TimeSlot {
  startHour: number; // 0-23
  endHour: number;   // 0-23
  days: number[];    // 0=Sun, 1=Mon ... 6=Sat (empty = every day)
}

export interface Genre {
  id: string;
  name: GenreName | string;
  emoji: string;
  color: string;
  trackIds: string[];
  schedule: TimeSlot | null; // null = manual only
  isActive: boolean;
}

const GENRES_KEY = 'ndr_genres';

const DEFAULT_GENRES: Genre[] = [
  { id: 'afrobeats',  name: 'Afrobeats',  emoji: '🎵', color: '#f59e0b', trackIds: [], schedule: { startHour: 12, endHour: 20, days: [] }, isActive: true },
  { id: 'amapiano',   name: 'Amapiano',   emoji: '🎹', color: '#8b5cf6', trackIds: [], schedule: { startHour: 20, endHour: 24, days: [5, 6] }, isActive: true },
  { id: 'rnb',        name: 'R&B',        emoji: '🎤', color: '#ec4899', trackIds: [], schedule: { startHour: 22, endHour: 2,  days: [] }, isActive: true },
  { id: 'gospel',     name: 'Gospel',     emoji: '🙏', color: '#10b981', trackIds: [], schedule: { startHour: 6,  endHour: 10, days: [0] }, isActive: true },
  { id: 'hiphop',     name: 'Hip-Hop',    emoji: '🎧', color: '#3b82f6', trackIds: [], schedule: { startHour: 18, endHour: 22, days: [] }, isActive: true },
  { id: 'highlife',   name: 'Highlife',   emoji: '🎺', color: '#f97316', trackIds: [], schedule: null, isActive: true },
  { id: 'reggae',     name: 'Reggae',     emoji: '🌿', color: '#22c55e', trackIds: [], schedule: { startHour: 14, endHour: 18, days: [] }, isActive: true },
  { id: 'gospel_wk',  name: 'Gospel',     emoji: '⛪', color: '#14b8a6', trackIds: [], schedule: { startHour: 6,  endHour: 12, days: [0, 6] }, isActive: true },
  { id: 'general',    name: 'General',    emoji: '🎶', color: '#6b7280', trackIds: [], schedule: null, isActive: true },
];

export function getGenres(): Genre[] {
  const saved = localStorage.getItem(GENRES_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  saveGenres(DEFAULT_GENRES);
  return DEFAULT_GENRES;
}

export function saveGenres(genres: Genre[]): void {
  localStorage.setItem(GENRES_KEY, JSON.stringify(genres));
}

export function saveGenre(genre: Genre): void {
  const genres = getGenres();
  const idx = genres.findIndex(g => g.id === genre.id);
  if (idx >= 0) genres[idx] = genre;
  else genres.push(genre);
  saveGenres(genres);
}

export function deleteGenre(id: string): void {
  saveGenres(getGenres().filter(g => g.id !== id));
}

export function addTrackToGenre(genreId: string, trackId: string): void {
  const genres = getGenres();
  const genre = genres.find(g => g.id === genreId);
  if (genre && !genre.trackIds.includes(trackId)) {
    genre.trackIds.push(trackId);
    saveGenres(genres);
  }
}

export function removeTrackFromGenre(genreId: string, trackId: string): void {
  const genres = getGenres();
  const genre = genres.find(g => g.id === genreId);
  if (genre) {
    genre.trackIds = genre.trackIds.filter(id => id !== trackId);
    saveGenres(genres);
  }
}

// ── Get the active genre for the current time ─────────────────────────────────
export function getActiveGenre(): Genre | null {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const genres = getGenres().filter(g => g.isActive && g.schedule && g.trackIds.length > 0);

  for (const genre of genres) {
    const s = genre.schedule!;
    const dayMatch = s.days.length === 0 || s.days.includes(day);
    if (!dayMatch) continue;

    // Handle overnight slots (e.g. 22-2)
    const inSlot = s.startHour <= s.endHour
      ? hour >= s.startHour && hour < s.endHour
      : hour >= s.startHour || hour < s.endHour;

    if (inSlot) return genre;
  }
  return null;
}

// ── Get tracks for a genre from the full media list ───────────────────────────
export function getGenreTracks(genre: Genre, allTracks: MediaFile[]): MediaFile[] {
  return genre.trackIds
    .map(id => allTracks.find(t => t.id === id))
    .filter(Boolean) as MediaFile[];
}

export function formatTimeSlot(slot: TimeSlot | null): string {
  if (!slot) return 'Manual';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayStr = slot.days.length === 0 ? 'Daily' : slot.days.map(d => days[d]).join(', ');
  const fmt = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;
  return `${fmt(slot.startHour)}–${fmt(slot.endHour)} · ${dayStr}`;
}
