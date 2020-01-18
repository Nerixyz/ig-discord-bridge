import { IgMessageBot } from './IgMessageBot';
import { UserRegister } from './UserRegister';
import { MessageSyncMessage, RegularMediaItem, VoiceMediaItem } from 'instagram_mqtt';
import { Attachment, RichEmbed, TextChannel } from 'discord.js';
import {
    downloadFile, downloadToBuffer,
    generateColorForUser,
    getBestResMedia, hashString,
    transcodeAudioItem,
    useFile,
    videoCachePath,
} from './utilities';
import { DateTime } from 'luxon';
import { IgMediaTypes } from './types';
import * as imgur from 'imgur';
import { post } from 'request-promise';
import { AuthStreamable, STATUS_CODE } from 'streamable-js';
import path from 'path';

interface SendMediaToChannelParams {
    media: RegularMediaItem;
    channel: TextChannel;
    baseEmbed: RichEmbed;
    text: string;
}

export class DiscordHandler {
    protected userRegister: UserRegister;
    constructor(protected parent: IgMessageBot) {
        this.userRegister = parent.userRegister;
    }

    public async sendMessageToChannel(message: MessageSyncMessage, channel: TextChannel): Promise<any> {
        const author = await this.userRegister.getById(message.user_id);
        const baseEmbed = new RichEmbed()
            .setAuthor(author.username, author.profile_pic_url)
            .setColor(generateColorForUser(message.user_id))
            .setTimestamp(DateTime.fromMillis(Number(message.timestamp) / 1000).toJSDate());
        switch (message.item_type) {
            case 'voice_media': {
                return this.sendAudioToChannel(message.voice_media, channel);
            }
            case 'text':
                return channel.send(baseEmbed.setDescription(message.text));
            case 'raven_media':
                return this.sendMediaToChannel({
                    media: message.visual_media.media,
                    channel, baseEmbed, text: message.text,
                });
            case 'media': {
                return this.sendMediaToChannel({ media: message.media, channel, baseEmbed, text: message.text });
            }
            default: {
                return channel.sendCode('json', JSON.stringify(message, undefined, 2).substring(0, 1990));
            }
        }
    }

    protected async sendMediaToChannel({ media, channel, baseEmbed, text }: SendMediaToChannelParams): Promise<void> {
        if (media.media_type === IgMediaTypes.Photo) {
            const { data: { link: url } } = await imgur.uploadUrl(getBestResMedia(media.image_versions2.candidates).url);
            await channel.send(
                baseEmbed
                    .setDescription(text ?? '')
                    .setImage(url),
            );
        } else if (media.media_type === IgMediaTypes.Video) {
            // @ts-ignore
            const bestVideo = getBestResMedia(media.video_versions).url;
            if (!this.parent.initOptions.streamableUsername || !this.parent.initOptions.streamablePassword) {
                await channel.send(bestVideo);
                return;
            }

            // @ts-ignore
            const {url} = await useFile(path.join(videoCachePath, `${media.id}.mp4`), async (file) => {
                await downloadFile(bestVideo, file);
                const streamable = new AuthStreamable(this.parent.initOptions.streamableUsername, this.parent.initOptions.streamablePassword);
                return streamable.uploadVideo(file).then(r => streamable.waitFor(r.shortcode, STATUS_CODE.READY));
            });

            await channel.send(`https://${url}`);
        } else {
            await channel.send(`Unknown media type: ${media.media_type}`);
        }
    }

    protected async sendAudioToChannel(audio: VoiceMediaItem, channel: TextChannel) {
        const buffer = await transcodeAudioItem(audio.media.audio.audio_src);
        await channel.send('', new Attachment(buffer).setName(`ig-discord-audio-${audio.media.id}.mp3`));
    }

}
