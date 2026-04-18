
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
  url: string; // This will hold the Object URL in-memory
  file?: File | Blob; // The persistent binary data
  type: 'audio' | 'video' | 'image';
  timestamp: number;
  likes?: number;
  isLive?: boolean;       // Whether this video is pushed to listener screen
  caption?: string;       // Optional caption shown on listener screen
  sponsorName?: string;   // Sponsor label shown on listener screen
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

export enum UserRole {
  LISTENER = 'LISTENER',
  ADMIN = 'ADMIN'
}
