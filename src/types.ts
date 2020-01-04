import { Client, Message, MessageAttachment, Snowflake, TextChannel, User } from 'discord.js';
import { Duration } from 'luxon';
import { DirectThreadEntity } from 'instagram-private-api';
import { UserRegister } from './UserRegister';

export interface MessageBotInitOptions {
    discordToken: string;
    discordServerId: string;
    instagramUsername: string;
    instagramPassword: string;
}

export type Tree = string[] | Tree[] | { [x: string]: Tree };
export type DataKey = string;

export enum TwoFactorMode {
    NOT_SUPPORTED = -2,
    MULTIPLE = -1,
    TOTP,
    SMS,
}

export enum InstagramLoginResult {
    OK,
    FAIL,
    NO_TWO_FACTOR,
}

export interface MultipleChoiceOptions {
    message: string;
    title: string;
    options: MultipleChoiceOption[];
    channel: TextChannel;
}

export interface MultipleChoiceOption {
    emoji: string;
    description: string;
    id: number;
}

export interface TextInputOptions {
    channel: TextChannel;
    title: string;
    message: string;
    userValidation?: (user: User) => boolean;
    inputValidation?: (input: string) => boolean;
    prefix?: string;
    timeout: Duration;
}

export enum IgMediaTypes {
    Photo = 1,
    Video = 2,
}

export type IgUserId = string | number | bigint;
export type IgThreadId = string;

export interface DiscordChannelMapping {
    callbackChannel: string;
    directData: Map<IgThreadId | IgUserId[], Snowflake>;
    igMessageCategory: string;
}

export interface CommandConfig<T> {
    name: string | string[];
    arguments?: CommandArgument[];
    onMessage: CommandCallback<T>;
}

export type CommandCallback<T> = (value: T, initialMessage: Message) => PromiseLike<any>;

export interface CommandArgument {
    name: string;
    requireName?: boolean;
    inputValidator?: (input: string) => boolean;
    optional?: boolean;
}

export interface ParsedArguments {
    [x: string]: string;
}

export interface SendAttachmentOptions {
    thread: DirectThreadEntity;
    attachment: MessageAttachment;
}
