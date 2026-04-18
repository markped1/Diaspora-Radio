
export interface NewsItem {
  id: string;
  title: string;
  content: string;
  category: 'Nigeria' | 'Diaspora' | 'Culture' | 'Economy' | 'Listener Report' | 'Sports' | 'Global';
  timestamp: number;
  location?: string;
  sources?: string[];
  isVerified?: boolean;
}

export interface MediaFile {
  id: string;
  name: string;
  url: string;
  file?: File | Blob;
  type: 'audio' | 'video' | 'image' | 'youtube' | 'iptv';
  timestamp: number;
  likes?: number;
  isLive?: boolean;
  caption?: string;
  sponsorName?: string;
  youtubeId?: string; // YouTube video/stream ID
}

export interface AdminMessage {
  id: string;
  text: string;
  timestamp: number;
}

export interface DjScript {
  id: string;
  script: string;
  audioData?: string;
  timestamp: number;
}

export interface AdminLog {
  id: string;
  action: string;
  timestamp: number;
}

export interface ListenerReport {
  id: string;
  reporterName: string;
  location: string;
  content: string;
  timestamp: number;
}

export interface SocialLink {
  id: string;
  platform: 'facebook' | 'twitter' | 'instagram' | 'youtube' | 'tiktok' | 'whatsapp' | 'telegram' | 'website' | 'other';
  label: string;
  url: string;
  timestamp: number;
}

export interface SportChannel {
  id: string;
  name: string;
  url: string;           // embed URL or m3u8 or iframe src
  logo: string;          // emoji or image URL
  category: 'Football' | 'Basketball' | 'Cricket' | 'Tennis' | 'Boxing' | 'MMA' | 'Rugby' | 'Movies' | 'General';
  isLive?: boolean;
  matchInfo?: string;    // e.g. "Man Utd vs Arsenal — 20:00"
  timestamp: number;
}

export enum UserRole {
  LISTENER = 'LISTENER',
  ADMIN = 'ADMIN'
}
