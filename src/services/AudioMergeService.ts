import ffmpeg from "fluent-ffmpeg";
import tmp from "tmp-promise";
import { FileOptions, MergeOptions } from "../types";
import { Logger } from "../utils/logger";

// Try to detect FFmpeg paths dynamically
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

export class AudioMergeService {
  private logger = new Logger("AudioMergeService");

  constructor() {
    this.configureFfmpeg();
  }

  private configureFfmpeg() {
    // Set FFmpeg paths with fallbacks
    const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
    const ffprobePath = process.env.FFPROBE_PATH || ffprobeStatic || "ffprobe";

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);

    this.logger.log(
      `FFmpeg configured with paths: ${ffmpegPath}, ${ffprobePath}`
    );
  }

  private getAudioCodec(format: string): string {
    // Map format to proper codec name
    const codecMap: { [key: string]: string } = {
      mp3: "libmp3lame",
      aac: "aac",
      m4a: "aac",
      wav: "pcm_s16le",
      flac: "flac",
      ogg: "libvorbis",
    };

    return codecMap[format] || "libmp3lame"; // Default to libmp3lame
  }

  // Analyze input files to determine best quality settings
  private async analyzeInputFiles(files: string[]): Promise<{
    maxBitrate: number;
    maxSampleRate: number;
    channels: number;
    suggestedFormat: string;
  }> {
    return new Promise((resolve, reject) => {
      let maxBitrate = 128;
      let maxSampleRate = 44100;
      let channels = 2;
      let hasLossless = false;
      let filesAnalyzed = 0;

      files.forEach((file, index) => {
        ffmpeg.ffprobe(file, (err, metadata) => {
          if (err) {
            this.logger.error(`Failed to analyze file ${file}:`, err);
          } else {
            const audioStream = metadata.streams.find(
              (s) => s.codec_type === "audio"
            );
            if (audioStream) {
              // Track highest quality settings found
              if (audioStream.bit_rate) {
                maxBitrate = Math.max(
                  maxBitrate,
                  parseInt(String(audioStream.bit_rate)) / 1000
                );
              }
              if (audioStream.sample_rate) {
                maxSampleRate = Math.max(
                  maxSampleRate,
                  audioStream.sample_rate
                );
              }
              if (audioStream.channels) {
                channels = Math.max(channels, audioStream.channels);
              }

              // Check for lossless formats - handle undefined codec_name
              const codecName = audioStream.codec_name || "unknown";
              if (
                ["flac", "alac", "wav", "pcm_s16le", "pcm_s24le"].includes(
                  codecName
                )
              ) {
                hasLossless = true;
              }

              this.logger.log(
                `File ${index + 1}: ${codecName}, ${
                  audioStream.bit_rate
                    ? Math.round(
                        parseInt(String(audioStream.bit_rate)) / 1000
                      ) + "kbps"
                    : "unknown bitrate"
                }, ${audioStream.sample_rate || "unknown"}Hz, ${
                  audioStream.channels || "unknown"
                }ch`
              );
            }
          }

          filesAnalyzed++;
          if (filesAnalyzed === files.length) {
            // Determine best output format and settings
            const suggestedFormat = hasLossless ? "flac" : "mp3";

            // For MP3, cap at 320kbps (maximum), for lossless keep original
            if (!hasLossless) {
              maxBitrate = Math.min(Math.max(maxBitrate, 192), 320); // At least 192, max 320
            }

            resolve({
              maxBitrate,
              maxSampleRate,
              channels,
              suggestedFormat,
            });
          }
        });
      });
    });
  }

  async mergeAudios(
    files: string[],
    options: MergeOptions = {}
  ): Promise<FileOptions> {
    // Analyze input files to determine optimal settings
    const analysis = await this.analyzeInputFiles(files);

    const {
      bitrate = analysis.maxBitrate,
      channels = analysis.channels,
      format = analysis.suggestedFormat,
      threads = 1,
    } = options;

    this.logger.log(
      `Quality analysis: ${analysis.maxBitrate}kbps, ${analysis.maxSampleRate}Hz, ${analysis.channels}ch, suggested format: ${analysis.suggestedFormat}`
    );
    this.logger.log(
      `Using settings: ${bitrate}kbps, ${channels}ch, format: ${format}`
    );

    const outputFile = await tmp.file({ postfix: `.${format}` });
    const tempDir = await tmp.dir({ unsafeCleanup: true });
    console.log("tempDir: ", tempDir);

    return new Promise((resolve, reject) => {
      this.logger.log(`Starting merge of ${files.length} files`);
      const command = ffmpeg();

      files.forEach((file, index) => {
        this.logger.log(`Adding input file ${index + 1}: ${file}`);
        command.input(file);
      });

      const audioCodec = this.getAudioCodec(format);
      this.logger.log(`Using audio codec: ${audioCodec} for format: ${format}`);

      // Build command based on format
      if (format === "flac") {
        // Lossless FLAC encoding
        command
          .audioCodec("flac")
          .audioChannels(channels)
          .audioFrequency(analysis.maxSampleRate)
          .outputOptions([
            `-threads ${threads}`,
            "-compression_level 8", // Maximum compression for smaller file size
            "-exact_rice_parameters 1", // Better compression
            "-avoid_negative_ts make_zero",
            "-max_muxing_queue_size 1024",
          ]);
      } else if (format === "wav") {
        // Uncompressed WAV
        command
          .audioCodec("pcm_s16le")
          .audioChannels(channels)
          .audioFrequency(analysis.maxSampleRate)
          .outputOptions([
            `-threads ${threads}`,
            "-avoid_negative_ts make_zero",
            "-max_muxing_queue_size 1024",
          ]);
      } else {
        // High-quality lossy encoding (MP3, AAC, etc.)
        const outputOptions = [
          `-threads ${threads}`,
          "-avoid_negative_ts make_zero",
          "-max_muxing_queue_size 1024",
        ];

        // Add VBR highest quality for MP3
        if (format === "mp3") {
          outputOptions.push("-q:a 0");
        }

        command
          .audioCodec(audioCodec)
          .audioBitrate(bitrate)
          .audioChannels(channels)
          .audioFrequency(analysis.maxSampleRate)
          .outputOptions(outputOptions);
      }

      command
        .on("start", (commandLine) => {
          this.logger.log("FFmpeg started with command:", commandLine);
        })
        .on("end", () => {
          this.logger.log("FFmpeg merge completed successfully");
          resolve({
            ...outputFile,
            cleanup: async () => {
              try {
                await Promise.all([outputFile.cleanup(), tempDir.cleanup()]);
                this.logger.log("All temporary files cleaned up successfully");
              } catch (error) {
                this.logger.error("Cleanup error:", error);
              }
            },
          });
        })
        .on("error", (error) => {
          this.logger.error("FFmpeg error:", error);
          outputFile.cleanup();
          reject(error);
        })
        .mergeToFile(outputFile.path, tempDir.path);
    });
  }

  // Convenience method for high-quality merging
  async mergeAudiosHighQuality(files: string[]): Promise<FileOptions> {
    return this.mergeAudios(files, {
      bitrate: 320, // Maximum MP3 bitrate
      format: "mp3",
    });
  }

  // Convenience method for lossless merging
  async mergeAudiosLossless(files: string[]): Promise<FileOptions> {
    return this.mergeAudios(files, {
      format: "flac",
    });
  }
}
