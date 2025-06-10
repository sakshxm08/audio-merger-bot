# Audio Merger Telegram Bot

A Telegram bot that merges multiple audio files into a single audio file while maintaining original quality.

## Features

- Merge up to 10 audio files per session
- Support for MP3, WAV, OGG, M4A formats
- Queue management system
- Large file support (up to 2GB with local Bot API server)
- High-quality audio processing with FFmpeg

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Build the project: `npm run build`
5. Start the bot: `npm start`

## Development

- `npm run dev` - Start in development mode with auto-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start the production build

## Environment Variables

See `.env.example` for required environment variables.

## Deployment

This bot can be deployed to Railway, Render, or similar platforms that support Node.js and FFmpeg.
