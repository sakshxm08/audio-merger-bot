import "dotenv/config";
import "./utils/logger";
import { AudioBotService } from "./services/AudioBotService";
import { startPeriodicCleanup } from "./cleanup-service";

// Temporary directory setup
import tmp from "tmp-promise";
tmp.setGracefulCleanup();

async function main() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.error("TELEGRAM_TOKEN environment variable is required");
    process.exit(1);
  }

  const apiRoot = process.env.LOCAL_TELEGRAM_API_ROOT;

  // Initialize the bot service
  const botService = new AudioBotService(token, apiRoot);

  // Start periodic cleanup for Telegram Bot API files
  const telegramApiDirectory =
    process.env.CLEANUP_DIRECTORY ||
    (process.env.NODE_ENV === "development"
      ? "../telegram-bot-api"
      : "/var/lib/telegram-bot-api");

  startPeriodicCleanup(telegramApiDirectory, 24);

  // Launch bot
  await botService.launch();

  // Graceful shutdown
  process.once("SIGINT", () => {
    console.log("Received SIGINT, shutting down gracefully...");
    botService.stop();
  });

  process.once("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down gracefully...");
    botService.stop();
  });
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
