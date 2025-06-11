module.exports = {
  apps: [
   {
    name: 'audio-merger-bot',
    script: 'dist/index.js',
    cwd: '/home/saksham/Desktop/telegram-bots/audio-merger-bot',
    instances: 1,
    max_memory_restart: '800M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }
 ]
};
