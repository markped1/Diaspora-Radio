
import { NewsItem, DjScript, AdminLog, MediaFile, AdminMessage, ListenerReport, SocialLink, SportChannel } from '../types';

const DB_NAME = 'NDN_RADIO_DB';
const MEDIA_STORE = 'media_files';
const CACHE_STORE = 'cached_audio';
const DB_VERSION = 2;

class DBService {
  private STORAGE_KEYS = {
    NEWS: 'ndn_radio_news',
    SCRIPTS: 'ndn_radio_scripts',
    LOGS: 'ndn_radio_logs',
    ADMIN_MSGS: 'ndn_radio_admin_msgs',
    REPORTS: 'ndn_radio_reports',
    LAST_SYNC: 'ndn_radio_last_sync',
    SOCIAL_LINKS: 'ndn_radio_social_links',
    SPORT_CHANNELS: 'ndn_radio_sport_channels',
    LIVE_STREAM_URL: 'ndn_radio_live_stream_url',
  };

  private async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getCachedAudio(key: string): Promise<Uint8Array | null> {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE, 'readonly');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async setCachedAudio(key: string, data: Uint8Array): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getNews(): Promise<NewsItem[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.NEWS);
    const news: NewsItem[] = data ? JSON.parse(data) : [];
    // Strict 48-hour filter (Current News Only)
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    return news.filter(n => n.timestamp > fortyEightHoursAgo);
  }

  async cleanupOldNews(): Promise<void> {
    const news = await this.getNews();
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const freshNews = news.filter(n => n.timestamp > fortyEightHoursAgo);
    localStorage.setItem(this.STORAGE_KEYS.NEWS, JSON.stringify(freshNews));
  }

  async saveNews(news: NewsItem[]): Promise<void> {
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const freshOnly = news.filter(n => n.timestamp > fortyEightHoursAgo);
    localStorage.setItem(this.STORAGE_KEYS.NEWS, JSON.stringify(freshOnly));
    localStorage.setItem(this.STORAGE_KEYS.LAST_SYNC, Date.now().toString());
  }

  async getLastSyncTime(): Promise<number> {
    const time = localStorage.getItem(this.STORAGE_KEYS.LAST_SYNC);
    return time ? parseInt(time, 10) : 0;
  }

  async addScript(script: DjScript): Promise<void> {
    const scripts = await this.getScripts();
    scripts.unshift(script);
    localStorage.setItem(this.STORAGE_KEYS.SCRIPTS, JSON.stringify(scripts.slice(0, 50)));
  }

  async getScripts(): Promise<DjScript[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.SCRIPTS);
    return data ? JSON.parse(data) : [];
  }

  async addMedia(file: MediaFile): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      if (!file.likes) file.likes = 0;
      const request = store.put(file);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMedia(): Promise<MediaFile[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readonly');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result as MediaFile[];
        resolve(results.sort((a, b) => b.timestamp - a.timestamp));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateMedia(file: MediaFile): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.put(file);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMedia(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE, 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAdminMessages(): Promise<AdminMessage[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.ADMIN_MSGS);
    return data ? JSON.parse(data) : [];
  }

  async clearAdminMessages(): Promise<void> {
    localStorage.removeItem(this.STORAGE_KEYS.ADMIN_MSGS);
  }

  async addAdminMessage(msg: AdminMessage): Promise<void> {
    const msgs = await this.getAdminMessages();
    msgs.unshift(msg);
    // Keep only recent messages to prevent ticker bloat
    localStorage.setItem(this.STORAGE_KEYS.ADMIN_MSGS, JSON.stringify(msgs.slice(0, 5)));
  }

  async addReport(report: ListenerReport): Promise<void> {
    const reports = await this.getReports();
    reports.unshift(report);
    localStorage.setItem(this.STORAGE_KEYS.REPORTS, JSON.stringify(reports.slice(0, 50)));
  }

  async getReports(): Promise<ListenerReport[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.REPORTS);
    return data ? JSON.parse(data) : [];
  }

  async addLog(log: AdminLog): Promise<void> {
    const logs = await this.getLogs();
    logs.unshift(log);
    localStorage.setItem(this.STORAGE_KEYS.LOGS, JSON.stringify(logs.slice(0, 100)));
  }

  async getLogs(): Promise<AdminLog[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.LOGS);
    return data ? JSON.parse(data) : [];
  }

  async getSocialLinks(): Promise<SocialLink[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.SOCIAL_LINKS);
    return data ? JSON.parse(data) : [];
  }

  async saveSocialLink(link: SocialLink): Promise<void> {
    const links = await this.getSocialLinks();
    const idx = links.findIndex(l => l.id === link.id);
    if (idx >= 0) links[idx] = link;
    else links.push(link);
    localStorage.setItem(this.STORAGE_KEYS.SOCIAL_LINKS, JSON.stringify(links));
  }

  async deleteSocialLink(id: string): Promise<void> {
    const links = await this.getSocialLinks();
    localStorage.setItem(
      this.STORAGE_KEYS.SOCIAL_LINKS,
      JSON.stringify(links.filter(l => l.id !== id))
    );
  }

  async getSportChannels(): Promise<SportChannel[]> {
    const data = localStorage.getItem(this.STORAGE_KEYS.SPORT_CHANNELS);
    return data ? JSON.parse(data) : [];
  }

  async saveSportChannel(ch: SportChannel): Promise<void> {
    const channels = await this.getSportChannels();
    const idx = channels.findIndex(c => c.id === ch.id);
    if (idx >= 0) channels[idx] = ch;
    else channels.unshift(ch);
    localStorage.setItem(this.STORAGE_KEYS.SPORT_CHANNELS, JSON.stringify(channels));
  }

  async deleteSportChannel(id: string): Promise<void> {
    const channels = await this.getSportChannels();
    localStorage.setItem(
      this.STORAGE_KEYS.SPORT_CHANNELS,
      JSON.stringify(channels.filter(c => c.id !== id))
    );
  }

  getLiveStreamUrl(): string {
    return localStorage.getItem(this.STORAGE_KEYS.LIVE_STREAM_URL) || '';
  }

  setLiveStreamUrl(url: string): void {
    localStorage.setItem(this.STORAGE_KEYS.LIVE_STREAM_URL, url);
  }
}

export const dbService = new DBService();
