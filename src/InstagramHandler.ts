import { UserRegister } from './UserRegister';
import { IgMessageBot } from './IgMessageBot';
import { ThreadRegister } from './ThreadRegister';
import { IgApiClientRealtime } from 'instagram_mqtt';
import { Message } from 'discord.js';
import { IgThreadId, IgUserId } from './types';
import { sendAttachment, sendEmbed } from './utilities';

export class InstagramHandler {

    constructor(protected client: IgMessageBot) {
    }

    public async sendDiscordMessage(message: Message, threadData: IgThreadId | IgUserId[]): Promise<void> {
        // @ts-ignore -> DirectThreadEntity supports also number as input
        const entity = this.client.ig.entity.directThread(threadData);
        if (message.embeds.length > 0) {
            for (const embed of message.embeds) {
                await sendEmbed(entity, embed);
            }
        } else if (message.attachments.size > 0) {
            for (const attachment of message.attachments.array()) {
                await sendAttachment({ thread: entity, attachment });
            }
        }
        if (message.content.length > 0) {
            await entity.broadcastText(message.content);
        }
        if (typeof threadData === 'object' && entity.threadId) {
            this.client.channelMapping.directData.set(entity.threadId, this.client.channelMapping.directData.get(threadData));
            this.client.channelMapping.directData.delete(threadData);
            threadData = entity.threadId;
            this.client.scheduleUpdateChannelMapping();
            console.log(`Updated to ${threadData}`);
        }
        await message.delete();
    }

}
