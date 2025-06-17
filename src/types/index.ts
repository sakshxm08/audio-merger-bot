export interface AudioQueueItem {
  fileId: string;
  fileName: string;
  userId: number;
  timestamp: number;
}

export interface MixedQueueItem {
  type: "youtube" | "audio_file";
  content: string; // URL for YouTube, file_id for audio
  fileName?: string;
  timestamp: number;
}

export interface UserSession {
  audioFiles: AudioQueueItem[];
  mixedQueue: MixedQueueItem[];
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

export interface FileOptions {
  path: string;
  cleanup: () => void;
}
