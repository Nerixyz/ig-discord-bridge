import { IgApiClient, UserRepositoryInfoResponseUser } from 'instagram-private-api';
import { DateTime, Duration } from 'luxon';
import { AppPresenceEvent } from 'instagram_mqtt';
import Chance from 'chance';
import { existsSync } from 'fs';
import Jimp from 'jimp';

export class UserRegister {
    register: Map<string, UserRegisterData> = new Map<string, UserRegisterData>();
    protected chance = new Chance();

    constructor(public client: IgApiClient) {}

    public async getById(id: string | bigint | number): Promise<UserRegisterData> {
        id = id.toString();
        const reg = this.register.get(id);
        if (reg) return reg;
        const res = await this.client.user.info(id);
        this.registerUser(id, res);
        return res;
    }

    public async getByName(name: string): Promise<UserRegisterData> {
        for (const item of this.register.values()) {
            if (item.username === name) return item;
        }
        const id = await this.client.user.getIdByUsername(name);
        const res = await this.client.user.info(id);
        this.registerUser(id.toString(), res);
        return res;
    }

    public async updateActivity(activity: AppPresenceEvent): Promise<UserRegisterData> {
        const data = await this.getById(activity.user_id);
        if (data.lastActive) {
            data.lastActiveDuration = DateTime.local().diff(data.lastActive);
        }
        if (data.notificationId) {
            data.notificationClearId = data.notificationId;
        }
        data.notificationId = this.chance.guid({ version: 4 });
        data.lastActive = DateTime.fromMillis(Number(activity.last_activity_at_ms));
        data.isActive = activity.is_active;
        return data;
    }

    private registerUser(id: string, data: UserRegisterData) {
        this.register.set(id, data);
        /* disable picture cache
        const path = `./_cache/img/profile/${data.pk}_pp.png`;
        if (existsSync(path)) {
            data.profilePicturePath = path;
        }
        process.nextTick(async () => {
            const image = await Jimp.read(data.profile_pic_url);
            await image.write(path);
            data.profilePicturePath = path;
        });*/
    }

    public getNameById = async (id: string | bigint | number): Promise<string> => (await this.getById(id)).username;
    public getIdByName = async (name: string): Promise<string | number> => (await this.getByName(name)).pk;
}

export interface UserData {
    lastActive?: DateTime;
    lastActiveDuration?: Duration;
    notificationId?: string;
    notificationClearId?: string;
    isActive?: boolean;
    profilePicturePath?: string;
}

export type UserRegisterData = UserData & UserRepositoryInfoResponseUser;
