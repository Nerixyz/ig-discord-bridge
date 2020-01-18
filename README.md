# ig-discord-bridge

This bot mirrors threads from Instagram in a channel on Discord.

# Usage
- Clone the repository.
- Execute `npm install && npm run build`.
- Create a `.env` file.
In your `.env` file set these:
```
IG_USERNAME=your instagram username
IG_PASSWORD=your instagram password
DISCORD_TOKEN=your discord bot token
DISCORD_SERVER_ID=your discord server id (right click > copy id)
STREAMABLE_USERNAME=[optional] streamable username
STREAMABLE_PASSWORD=[optional] streamable password
```
- Run the bot using `node .`

For videos on Windows make sure you have [ffmpeg](https://www.ffmpeg.org/download.html) installed
and the `bin/` directory is in the `PATH` (you can use it in the terminal/command prompt)
or the `bin/ffmpeg.exe` path is in `FFMPEG_PATH`.
For further information go [here](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg#installation).

# Features
- Send text, links, videos and photos from Discord
- Receive text, links, videos, photos, stories and voice messages on Discord

# Missing
- Voice recording
- Voice messages from discord
- Commands in each channel
- Better documentation
- Proper error handling
- Typing indicators
- Online statuses

