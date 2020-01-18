import {
    GraphQLSubscriptions,
    IgApiClientRealtime,
    MessageSyncMessage,
    MessageSyncMessageWrapper,
    SkywalkerSubscriptions,
    withRealtime,
} from 'instagram_mqtt';
import { UserRegister } from './UserRegister';
import {
    CommandConfig,
    DiscordChannelMapping,
    MessageBotInitOptions,
    IgThreadId,
    IgUserId,
    InstagramLoginResult,
    ParsedArguments,
} from './types';
import { Client, Guild, Message, MessageCollector, RichEmbed, Snowflake, TextChannel } from 'discord.js';
import { IgApiClient } from 'instagram-private-api';
import Bluebird from 'bluebird';
import {
    exhaustFeedUntil,
    hashString,
    prepareForJSON,
    readData,
    writeData,
    createArguments,
    createCommand,
    getTextChannel,
    instagramLogin,
    parseArgumentsToObject,
} from './utilities';
import { ThreadRegister } from './ThreadRegister';
import { DiscordHandler } from './DiscordHandler';
import { InstagramHandler } from './InstagramHandler';

export class IgMessageBot {
    public ig: IgApiClientRealtime;
    public userRegister: UserRegister;
    public threadRegister: ThreadRegister;
    public client: Client;
    public discordHandler: DiscordHandler;
    public instagramHandler: InstagramHandler;

    public initOptions: MessageBotInitOptions;
    public channelMapping: DiscordChannelMapping;
    public commandConfig: Array<CommandConfig<any>>;

    protected mainGuild: Guild;

    constructor(initOptions: MessageBotInitOptions) {
        this.initOptions = initOptions;
        this.ig = withRealtime(new IgApiClient());
        this.userRegister = new UserRegister(this.ig);
        this.threadRegister = new ThreadRegister(this.ig);
        this.commandConfig = [
            createCommand('add', createArguments('query'), (a, b) => this.handleAddCommand(a, b)),
            createCommand(['recent', 'recents', 'inbox'], [], (a, b) => this.handleRecentCommand(a, b)),
            createCommand('delete', createArguments('query'), (a, b) => this.deleteChannel(a, b)),
            createCommand('search', createArguments('query'), (a, b) => this.searchCommand(a, b)),
        ];
    }

    public async start(): Promise<void> {
        try {
            this.client = new Client();
            await this.client.login(this.initOptions.discordToken);
            this.mainGuild = this.client.guilds.get(this.initOptions.discordServerId);
            if (!this.mainGuild) throw new Error('Could not find Server');

            await this.readChannelMapping();
            this.startCommandService();

            const shouldLogin = await this.initInstagram();
            if (shouldLogin) {
                const res = await instagramLogin(this);
                if (res !== InstagramLoginResult.OK)
                    throw new Error(`Could not login ${InstagramLoginResult[res]?.toString() || 'undefined'}`);
            }

            await this.startRealtime();
            this.startListenerService();
            await this.threadRegister.initialize();
            this.instagramHandler = new InstagramHandler(this);
            this.discordHandler = new DiscordHandler(this);
        } catch (e) {
            if (!this.channelMapping || !this.channelMapping.callbackChannel) {
                console.error(e);
                process.exit(1);
            } else {
                getTextChannel(this.client, this.channelMapping.callbackChannel).sendCode(
                    '',
                    e.stack ?? e.message ?? e,
                );
            }
        }
    }

    // returns shouldLogin
    protected async initInstagram(): Promise<boolean> {
        this.ig.state.generateDevice(this.initOptions.instagramUsername);
        const dataKey = `${hashString(this.initOptions.instagramUsername)}.igSession`;
        this.ig.request.end$.subscribe(async () => writeData(dataKey, await this.ig.exportState()));
        await this.ig.importState(readData(dataKey));

        try {
            await this.ig.user.info(this.ig.state.cookieUserId);
            await this.ig.feed.directInbox().request();
            return false;
        } catch {
            return true;
        }
    }

    protected async readChannelMapping() {
        this.channelMapping = await readData<DiscordChannelMapping>('channelMapping', {
            callbackChannel: this.client.guilds.get(this.initOptions.discordServerId).systemChannelID,
            directData: new Map<IgThreadId | IgUserId[], Snowflake>(),
            igMessageCategory: undefined,
        });
        if (!(this.channelMapping.directData instanceof Map)) {
            // @ts-ignore
            this.channelMapping.directData = new Map<IgThreadId | IgUserId[], Snowflake>(
                this.channelMapping.directData,
            );
        }
        if (!this.channelMapping.igMessageCategory) {
            this.channelMapping.igMessageCategory = (
                await this.mainGuild.createChannel('IG MESSAGES', { type: 'category' })
            ).id;
            this.scheduleUpdateChannelMapping();
        }
    }

    public updateChannelMapping(): Promise<void> {
        return writeData('channelMapping', prepareForJSON(this.channelMapping));
    }

    public scheduleUpdateChannelMapping = () => process.nextTick(() => this.updateChannelMapping());

    protected async startRealtime() {
        this.ig.realtime.on('message', async ({ message }: MessageSyncMessageWrapper) => {
            if (message.op !== 'add') {
                console.log(message);
                return;
            }
            const channel = this.getChannel(message.thread_id);
            if (!channel) {
                this.handleMessageWithoutThread(message);
                return;
            }
            try {
                await this.discordHandler.sendMessageToChannel(message, channel);
                await this.ig.realtime.direct.markAsSeen({threadId: message.thread_id, itemId: message.item_id});
            } catch (e) {
                console.error(e);
                await channel.sendCode(
                    'json',
                    JSON.stringify({
                        message: e.message,
                        stack: e.stack,
                    }),
                );
            }
        });
        await this.ig.realtime.connect({
            graphQlSubs: [
                // these are some subscriptions
                GraphQLSubscriptions.getAppPresenceSubscription(),
                GraphQLSubscriptions.getClientConfigUpdateSubscription(),
                GraphQLSubscriptions.getZeroProvisionSubscription(this.ig.state.phoneId),
                GraphQLSubscriptions.getDirectStatusSubscription(),
                GraphQLSubscriptions.getDirectTypingSubscription(this.ig.state.cookieUserId),
                GraphQLSubscriptions.getAsyncAdSubscription(this.ig.state.cookieUserId),
            ],
            skywalkerSubs: [
                SkywalkerSubscriptions.directSub(this.ig.state.cookieUserId),
                SkywalkerSubscriptions.liveSub(this.ig.state.cookieUserId),
            ],
            irisData: await this.ig.feed.directInbox().request(),
        });
    }

    protected getChannel(threadId: string): TextChannel | undefined {
        const id = this.channelMapping.directData.get(threadId);
        return id ? getTextChannel(this.client, id) : undefined;
    }

    protected async handleMessageWithoutThread(message: MessageSyncMessage): Promise<void> {
        const {
            thread: { thread_title },
        } = await this.ig.feed.directThread({ thread_id: message.thread_id, oldest_cursor: undefined }).request();
        const channel = (await this.mainGuild.createChannel(thread_title, {
            type: 'text',
            parent: this.channelMapping.igMessageCategory,
        })) as TextChannel;
        const threadData = message.thread_id;
        this.channelMapping.directData.set(threadData, channel.id);
        this.addListenerToThread(threadData, channel.id);
        this.scheduleUpdateChannelMapping();
        await this.discordHandler.sendMessageToChannel(message, channel);
    }

    protected async searchCommand({ query }, message: Message) {
        const result = await this.threadRegister.getByNameSubset(query);
        if (!result) {
            await message.reply('No thread or user found');
        }
        await message.reply(
            new RichEmbed({
                fields: result.thread_id
                    ? [
                          { name: 'Thread Title', value: result.thread_title },
                          {
                              name: 'Members',
                              value: result.users.length.toString(),
                          },
                      ]
                    : [
                          { name: 'Username', value: result.username },
                          { name: 'Full Name', value: result.full_name },
                      ],
            })
                .setTitle(query)
                .setColor('#0fff0f'),
        );
    }

    protected startCommandService() {
        const collector = new MessageCollector(
            getTextChannel(this.client, this.channelMapping.callbackChannel),
            (msg: Message) => msg.content && msg.content.startsWith('.'),
        );
        collector.on('collect', async (message: Message) => {
            const [first] = message.content.split(' ');
            const command = this.commandConfig.find(c =>
                typeof c.name === 'string' ? c.name === first.substr(1) : c.name.includes(first.substr(1)),
            );
            if (!command) return;

            try {
                if (!command.arguments) {
                    await command.onMessage({}, message);
                    return;
                }
                await command.onMessage(
                    parseArgumentsToObject(message.content.substring(command.name.length + 1), command.arguments),
                    message,
                );
            } catch (e) {
                await message.reply(
                    new RichEmbed()
                        .setTitle(e.message ?? 'Error')
                        .setDescription(e.stack ?? e)
                        .setColor('#ff0000'),
                );
            }
        });
    }

    protected startListenerService() {
        for (const [threadData, channelId] of this.channelMapping.directData.entries()) {
            this.addListenerToThread(threadData, channelId);
        }
    }

    protected addListenerToThread(threadData: IgThreadId | IgUserId[], channelId: Snowflake) {
        const collector = new MessageCollector(
            getTextChannel(this.client, channelId),
            (msg: Message) => !msg.author.bot,
        );
        collector.on('collect', (message) => this.instagramHandler.sendDiscordMessage(message, threadData));
    }

    protected async handleAddCommand({ query }: ParsedArguments, message: Message) {
        const found = await this.threadRegister.getByName(query);

        if (!found) throw new Error('User or thread not found');

        const channel = (await this.mainGuild.createChannel(found.thread_id ? found.thread_title : found.username, {
            type: 'text',
            parent: this.channelMapping.igMessageCategory,
        })) as TextChannel;
        const threadData = found.thread_id ? found.thread_id : [found.pk];
        this.channelMapping.directData.set(threadData, channel.id);
        this.addListenerToThread(threadData, channel.id);
        await message.reply(`created channel for ${channel.name}`);
        this.scheduleUpdateChannelMapping();
        await this.initializeThread(threadData, channel);
    }

    protected async deleteChannel({ query }: ParsedArguments, message: Message) {
        let found;
        for (const entry of this.channelMapping.directData.entries()) {
            try {
                if (getTextChannel(this.client, entry[1]).name === query) {
                    found = entry;
                    break;
                }
                // tslint:disable-next-line:no-empty
            } catch {}
        }
        if (found) {
            await getTextChannel(this.client, found[1]).delete();
            this.channelMapping.directData.delete(found[0]);
            await message.reply('deleted.');
            this.scheduleUpdateChannelMapping();
        } else {
            await message.reply('could not find channel');
        }
    }

    protected async handleRecentCommand(_: any, message: Message) {
        const inbox = await this.ig.feed.directInbox().items();
        return message.reply(
            new RichEmbed({
                fields: inbox.map(i => ({
                    name: i.thread_title || 'Thread',
                    value: i.last_permanent_item
                        ? i.last_permanent_item.text ?? i.last_permanent_item.item_type
                        : i.users.map(u => u.username).join(', '),
                    inline: true,
                })),
            }).setTitle('Inbox'),
        );
    }

    protected async initializeThread(threadData: IgThreadId, channel: TextChannel) {
        const feed = this.ig.feed.directThread({ thread_id: threadData, oldest_cursor: undefined });
        const items = (await exhaustFeedUntil(feed, 5)).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        for (const i of items) {
            // @ts-ignore
            this.sendMessageToChannel(i, channel);
            await Bluebird.delay(1000);
        }
    }
}
