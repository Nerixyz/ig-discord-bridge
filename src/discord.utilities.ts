import {
    Client,
    Collection,
    Message,
    MessageCollector,
    MessageReaction,
    RichEmbed,
    Snowflake,
    TextChannel,
} from 'discord.js';
import {
    AccountRepositoryLoginErrorResponseTwoFactorInfo,
    IgApiClient,
    IgCheckpointError,
    IgLoginTwoFactorRequiredError,
} from 'instagram-private-api';
import {
    CommandArgument,
    CommandCallback,
    CommandConfig,
    DiscordChannelMapping,
    MessageBotInitOptions,
    InstagramLoginResult,
    MultipleChoiceOptions,
    ParsedArguments,
    TextInputOptions,
    TwoFactorMode,
} from './types';
import Bluebird from 'bluebird';
import { Duration } from 'luxon';

export async function instagramLogin(clients: {
    client: Client;
    ig: IgApiClient;
    initOptions: MessageBotInitOptions;
    channelMapping: DiscordChannelMapping;
}): Promise<InstagramLoginResult> {
    const { ig, client: discord, initOptions: options, channelMapping } = clients;
    // @ts-ignore
    const res = await Bluebird.try(() => ig.account.login(options.instagramUsername, options.instagramPassword))
        .catch(IgLoginTwoFactorRequiredError, async error => {
            const twoFactorInfo = error.response.body.two_factor_info;
            let mode: TwoFactorMode = getMode(twoFactorInfo);
            if (mode === TwoFactorMode.NOT_SUPPORTED) return InstagramLoginResult.NO_TWO_FACTOR;

            if (mode === TwoFactorMode.MULTIPLE) {
                mode = await multipleChoice({
                    channel: getTextChannel(discord, channelMapping.callbackChannel),
                    message: 'Select the two factor method you want to use.',
                    title: 'Two Factor Authentication',
                    options: [
                        {
                            emoji: '🔒',
                            id: 0,
                            description: 'TOTP (Authentication App like Google Authenticator)',
                        },
                        {
                            emoji: '📱',
                            id: 1,
                            description: 'SMS',
                        },
                    ],
                });
            }
            const code = await textInput({
                channel: getTextChannel(discord, channelMapping.callbackChannel),
                title: 'Two Factor Authentication',
                message: 'Type you code like this: .2fa <code>',
                prefix: '.2fa ',
                timeout: Duration.fromObject({ minutes: 5 }),
                inputValidation: input => /[0-9]{1,6}/.test(input),
            });
            await ig.account.twoFactorLogin({
                twoFactorIdentifier: twoFactorInfo.two_factor_identifier,
                username: twoFactorInfo.username,
                verificationMethod: Number(mode).toString(),
                verificationCode: code,
                trustThisDevice: '1',
            });
            return InstagramLoginResult.OK;
        })
        .catch(IgCheckpointError, async () => {
            await ig.challenge.auto(true);
            const code = await textInput({
                channel: getTextChannel(discord, channelMapping.callbackChannel),
                title: 'Two Factor Authentication',
                message: 'Type you code like this: .code <code>',
                prefix: '.code ',
                timeout: Duration.fromObject({ minutes: 5 }),
                inputValidation: input => /[0-9]{1,6}/.test(input),
            });
            await ig.challenge.sendSecurityCode(code);
            return InstagramLoginResult.OK;
        })
        .catch(e => {
            getTextChannel(discord, channelMapping.callbackChannel).send(
                new RichEmbed()
                    .setTitle('Error')
                    .setColor('#ff0000')
                    .setDescription(`An error occurred.\n${e.toString()}\n${e.stack}`),
            );
            console.error(e, e.stack);
            return InstagramLoginResult.FAIL;
        });
    if (typeof res === 'number') return res;
    return InstagramLoginResult.OK;
}

export function getTextChannel(discord: Client, id: string): TextChannel | undefined {
    const found = discord.channels.get(id);
    if (found && found instanceof TextChannel) return found;
    return undefined;
}

function getMode({
    totp_two_factor_on,
    sms_two_factor_on,
}: AccountRepositoryLoginErrorResponseTwoFactorInfo): TwoFactorMode {
    if (totp_two_factor_on && sms_two_factor_on) return TwoFactorMode.MULTIPLE;
    if (totp_two_factor_on) return TwoFactorMode.TOTP;
    if (sms_two_factor_on) return TwoFactorMode.SMS;
    return TwoFactorMode.NOT_SUPPORTED;
}

export async function multipleChoice({ options, channel, title, message }: MultipleChoiceOptions): Promise<number> {
    const msg = (await channel.send(
        new RichEmbed()
            .setTitle(title)
            .setDescription(`${message}\n\n${options.map(o => `${o.emoji} - ${o.description}`).join('\n')}`),
    )) as Message;
    const reactions: Array<Promise<Collection<Snowflake, MessageReaction>>> = [];
    for (const option of options) {
        await msg.react(option.emoji);
        reactions.push(
            msg.awaitReactions((r: MessageReaction) => options.some(o => o.emoji === r.emoji.name), {
                max: 1,
                time: 60000,
                errors: ['time'],
            }),
        );
    }
    const res = await Promise.race(reactions);
    const top: MessageReaction = res.reduce(
        (accumulator, value) => (value.count > accumulator.count ? value : accumulator),
        { count: -1 },
    );
    return options.find(o => o.emoji === top.emoji.name).id;
}

export async function textInput({
    channel,
    title,
    message,
    userValidation,
    inputValidation,
    prefix,
    timeout,
}: TextInputOptions): Promise<string> {
    userValidation = userValidation ?? (() => true);
    inputValidation = inputValidation ?? (() => true);
    prefix = prefix ?? '';

    await channel.send(new RichEmbed().setTitle(title).setDescription(message));
    return Promise.race<string>([
        new Promise<string>(resolve => {
            const collector = new MessageCollector(
                channel,
                (m: Message) =>
                    userValidation(m.author) &&
                    message.startsWith(prefix) &&
                    inputValidation(m.content?.substr(prefix.length) || ''),
            );
            collector.on('collect', data => {
                resolve(data.content);
            });
        }),
        Bluebird.delay(timeout.get('milliseconds')).then(() => Promise.reject<string>(new Error('Input timed out'))),
    ]);
}

export const createCommand = <T>(
    name: string | string[],
    commandArguments: CommandArgument[],
    onMessage: CommandCallback<T>,
): CommandConfig<T> => ({
    name,
    arguments: commandArguments,
    onMessage,
});

export function createArguments(...args: CommandArgument[] | string[]): CommandArgument[] {
    // @ts-ignore
    return args.map(a => (typeof a === 'string' ? { name: a } : a));
}

export function parseArgumentsToObject(message: string, cmdArguments: CommandArgument[]): ParsedArguments {
    let pos = 0;
    const result = {};
    for (const arg of cmdArguments) {
        const { data, pos: newPos } = extractArgument(message, pos, arg);
        pos = newPos;
        Object.defineProperty(result, arg.name, {
            value: data,
            enumerable: true,
        });
    }
    return result;
}

function extractArgument(message: string, position: number, argument: CommandArgument): { data: string; pos: number } {
    position = skipWhitespace(message, position);
    let value;
    if (argument.requireName) {
        value = {
            data: readUntil(message, message.indexOf(`-${argument.name}`) + argument.name.length + 2, '-').data,
            pos: position,
        };
    } else {
        value = readUntil(message, position, ' ');
    }
    if ((argument.inputValidator ?? (() => true))(value.data)) return value;
    throw new Error(`${argument.name}'s value is invalid`);
}

function skipWhitespace(message: string, pos: number): number {
    while (message.charAt(pos) === ' ') pos++;
    return pos;
}

function readUntil(message: string, start: number, stop: string): { data: string; pos: number } {
    if (start >= message.length - 1) return { data: '', pos: start };
    let out = '';
    // tslint:disable-next-line:quotemark
    if (['"', '`', "'"].includes(message.charAt(start))) stop = message.charAt(start);
    for (let i = start; i < message.length; i++) {
        const currentChar = message.charAt(i);
        if (currentChar === stop) {
            return { data: out, pos: i };
        }
        out += message.charAt(i);
    }
    return { data: out, pos: message.length - 1 };
}
