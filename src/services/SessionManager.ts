import * as fs from "fs";
import * as path from "path";
import { UserSession, AudioQueueItem, MixedQueueItem } from "../types";
import { Logger } from "../utils/logger";

export class SessionManager {
  private sessions = new Map<number, UserSession>();
  private sessionsFile: string;
  private logger = new Logger("SessionManager");
  private saveInterval: NodeJS.Timeout;

  constructor(sessionsFile: string = "./user-sessions.json") {
    this.sessionsFile = sessionsFile;
    this.loadSessions();

    // Auto-save every 30 seconds
    this.saveInterval = setInterval(() => {
      this.saveSessions();
    }, 30000);
  }

  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const data = fs.readFileSync(this.sessionsFile, "utf8");
        const sessions = JSON.parse(data);
        this.sessions = new Map(
          Object.entries(sessions).map(([k, v]) => [
            parseInt(k),
            v as UserSession,
          ])
        );
        this.logger.log(`Loaded ${this.sessions.size} sessions from file`);
      }
    } catch (error) {
      this.logger.error("Failed to load sessions:", error);
      this.sessions = new Map();
    }
  }

  private saveSessions(): void {
    try {
      const obj = Object.fromEntries(this.sessions);
      fs.writeFileSync(this.sessionsFile, JSON.stringify(obj, null, 2));
    } catch (error) {
      this.logger.error("Failed to save sessions:", error);
    }
  }

  getSession(userId: number): UserSession | undefined {
    return this.sessions.get(userId);
  }

  createSession(userId: number): UserSession {
    const session: UserSession = {
      audioFiles: [],
      mixedQueue: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(userId, session);
    this.saveSessions();
    return session;
  }

  updateSession(userId: number, session: UserSession): void {
    session.lastActivity = Date.now();
    this.sessions.set(userId, session);
    this.saveSessions();
  }

  deleteSession(userId: number): void {
    this.sessions.delete(userId);
    this.saveSessions();
  }

  addAudioFile(userId: number, audioFile: AudioQueueItem): boolean {
    let session = this.getSession(userId);
    if (!session) {
      session = this.createSession(userId);
    }

    if (session.audioFiles.length >= 20) {
      return false;
    }

    audioFile.timestamp = Date.now();
    session.audioFiles.push(audioFile);
    this.updateSession(userId, session);
    return true;
  }

  addMixedItem(userId: number, item: MixedQueueItem): boolean {
    let session = this.getSession(userId);
    if (!session) {
      session = this.createSession(userId);
    }

    if (session.mixedQueue.length >= 20) {
      return false;
    }

    item.timestamp = Date.now();
    session.mixedQueue.push(item);
    this.updateSession(userId, session);
    return true;
  }

  getMixedQueueStatus(userId: number): {
    count: number;
    items: MixedQueueItem[];
  } {
    const session = this.getSession(userId);
    return {
      count: session?.mixedQueue?.length || 0,
      items: session?.mixedQueue || [],
    };
  }

  clearMixedQueue(userId: number): void {
    const session = this.getSession(userId);
    if (session) {
      session.mixedQueue = [];
      this.updateSession(userId, session);
    }
  }

  getQueueStatus(userId: number): { count: number; files: AudioQueueItem[] } {
    const session = this.getSession(userId);
    return {
      count: session?.audioFiles.length || 0,
      files: session?.audioFiles || [],
    };
  }

  cleanupOldSessions(maxAgeHours: number = 24): number {
    const threshold = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [userId, session] of this.sessions.entries()) {
      if (session.lastActivity < threshold) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.saveSessions();
      this.logger.log(`Cleaned up ${cleaned} old sessions`);
    }

    return cleaned;
  }

  destroy(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.saveSessions();
  }
}
