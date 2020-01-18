import { IgMessageBot } from './IgMessageBot';
import 'dotenv/config';
import { createDirectoriesFromTree } from './utilities';

const client = new IgMessageBot({
    discordToken: process.env.DISCORD_TOKEN,
    discordServerId: process.env.DISCORD_SERVER_ID,
    instagramPassword: process.env.IG_PASSWORD,
    instagramUsername: process.env.IG_USERNAME,
    streamableUsername: process.env.STREAMABLE_USERNAME,
    streamablePassword: process.env.STREAMABLE_PASSWORD,
});
process.nextTick(async () => {
    await createDirectoriesFromTree(
        {
            _cache: [{ img: ['profile', 'video', 'audio'] }],
        },
        './',
    );
});
client
    .start()
    .then(() => console.log('Client started'))
    .catch(e => console.error(e, e.stack));
