import { DirectThreadEntity } from 'instagram-private-api';
import Jimp from 'jimp';
import path from 'path';
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import { promises } from 'fs';
import { SendAttachmentOptions } from '../types';
import { MessageEmbed } from 'discord.js';
import { arrayLast, deleteAll, downloadFile, hashString } from './data.utilities';
import exp from 'constants';

export const mediaCachePath = path.join('_cache', 'img');
export const audioCachePath = path.join(mediaCachePath, 'audio');
export const videoCachePath = path.join(mediaCachePath, 'video');
export const pictureCachePath = path.join(mediaCachePath, 'picture');

export async function sendAttachment({ thread, attachment }: SendAttachmentOptions) {
    if (['png', 'jpg', 'jpeg'].includes(arrayLast(attachment.filename.split('.')))) {
        await sendImage(thread, attachment.url);
    } else if (['webm', 'mp4'].includes(arrayLast(attachment.filename.split('.')))) {
        await sendVideo(thread, attachment.url);
    } else {
        console.log('Unknown attachment type');
    }
}

export async function sendEmbed(thread: DirectThreadEntity, embed: MessageEmbed) {
    if (embed.image) {
        await sendImage(thread, embed.image.url);
    } else if (embed.video) {
        await sendVideo(thread, embed.video.url);
    } else {
        console.log('Unknown embed');
    }
}

async function sendImage(thread: DirectThreadEntity, imageUrl: string) {
    const image = await Jimp.read(imageUrl);
    await thread.broadcastPhoto({
        file: await image.getBufferAsync('image/jpeg'),
        allowFullAspectRatio: true,
    });
}

async function sendVideo(thread: DirectThreadEntity, videoUrl: string) {
    const filePath = path.join(videoCachePath, `${hashString(videoUrl)}.mp4`);
    await executeFfmpegCommand(
        ffmpeg(videoUrl)
            .videoCodec('libx264')
            .audioCodec('aac')
            .saveToFile(filePath),
    );
    await thread.broadcastVideo({
        video: await promises.readFile(filePath),
    });
    await promises.unlink(filePath);
}
export async function transcodeAudioItem(audioUrl: string): Promise<Buffer> {
    const id = hashString(audioUrl);
    const basePath = path.join(audioCachePath, id);
    const filePath = basePath + '.mp3';
    await executeFfmpegCommand(
        ffmpeg(await downloadFile(audioUrl, basePath + '.m4a'))
            .saveToFile(filePath),
    );
    const buffer = await promises.readFile(filePath);
    await deleteAll(audioCachePath, id);
    return buffer;
}

export const executeFfmpegCommand = (cmd: FfmpegCommand): Promise<void> =>
    new Promise<void>((resolve, reject) => cmd.once('end', () => resolve()).once('error', e => reject(e)));
