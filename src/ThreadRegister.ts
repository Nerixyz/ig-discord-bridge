import { IgApiClient } from 'instagram-private-api';
import { getRemainingStringLength } from './utilities';
import { DirectRepositoryRankedRecipientsResponseUser } from 'instagram-private-api/dist/responses/direct.repository.ranked-recipients.response';

export class ThreadRegister {
    register: Map<ThreadId, ThreadRegisterData> = new Map<ThreadId, ThreadRegisterData>();

    constructor(public ig: IgApiClient) {}

    public async initialize(): Promise<void> {
        // TODO: setting, how many pages
        const inbox = await this.ig.feed.directInbox().items();
        const pending = await this.ig.feed.directPending().items();
        inbox.forEach(t => this.registerThread(t));
        pending.forEach(t => this.registerThread(t));
    }

    public async getById(id: ThreadId): Promise<ThreadRegisterData> {
        const reg = this.register.get(id);
        if (reg) return reg;
        return this.registerThread(
            (await this.ig.feed.directThread({ thread_id: id, oldest_cursor: undefined }).request()).thread,
        );
    }

    public async getByName(
        name: string,
    ): Promise<ThreadRegisterData | DirectRepositoryRankedRecipientsResponseUser | null> {
        for (const item of this.register.values()) {
            if (item.thread_title && item.thread_title === name) return item;
        }
        const recipients = await this.ig.direct.rankedRecipients('raven', name);
        const found = recipients.ranked_recipients.find(recipient =>
            recipient.thread ? recipient.thread.thread_title === name : recipient.user.username === name,
        );
        if (found?.thread) {
            return this.registerThread(found.thread);
        } else if (found?.user) {
            return found.user;
        }
        return null;
    }

    public async getByNameSubset(subset: string): Promise<ThreadRegisterData | null> {
        const byName = await this.getByName(subset);
        if (byName) return byName;

        subset = subset.toLowerCase();
        const recipients = await this.ig.direct.rankedRecipients('raven', subset);
        const found = recipients.ranked_recipients.filter(r =>
            r.thread
                ? r.thread.thread_title.toLowerCase().includes(subset)
                : r.user.username.toLowerCase().includes(subset),
        );
        if (found.length === 0) return null;
        if (found.length === 1) return found[0];
        found.sort((a, b) =>
            a.thread && !b.thread
                ? -1
                : !a.thread && !b.thread
                ? getRemainingStringLength(a.user.username, subset) - getRemainingStringLength(b.user.username, subset)
                : !a.thread && b.thread
                ? 1
                : getRemainingStringLength(a.thread.thread_title, subset) -
                  getRemainingStringLength(b.thread.thread_title, subset),
        );
        if (found[0].thread) {
            return this.registerThread(found[0].thread);
        } else  {
            return found[0].user;
        }
    }

    private registerThread(thread: ThreadRegisterData): ThreadRegisterData {
        this.register.set(thread.thread_id, thread);
        return thread;
    }
}

export type ThreadId = string;
export type ThreadRegisterData = { thread_id: ThreadId } & Partial<{ thread_title: string }> & any;
