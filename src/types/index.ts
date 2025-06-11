export interface AudioQueueItem {
  fileId: string;
  fileName: string;
  userId: number;
  timestamp: number;
}

export interface UserSession {
  audioFiles: AudioQueueItem[];
  createdAt: number;
  lastActivity: number;
}

export interface DownloadResult {
  path: string;
  cleanup: () => Promise<void>;
}

export interface MergeOptions {
  bitrate?: number;
  channels?: number;
  format?: string;
  threads?: number;
  quality?: "lossless" | "high" | "standard";
}

export interface ProcessingStatus {
  userId: number;
  status: "downloading" | "merging" | "uploading" | "completed" | "error";
  progress?: number;
  message?: string;
}
