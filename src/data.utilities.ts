import crypto from 'crypto';
import { DataKey, Tree } from './types';
import { existsSync, PathLike, promises } from 'fs';
import { Feed } from 'instagram-private-api';
import { BigInteger } from 'instagram_mqtt/dist/shared';
import { Chance } from 'chance';
import { join } from 'path';

export const hashString = (name: string): string =>
    crypto
        .createHash('sha256')
        .update(name)
        .digest('hex');

export const readData = async <T>(dataKey: DataKey, defaultT?: T): Promise<T> =>
    dataExists(dataKey)
        ? JSON.parse(await promises.readFile(`./data/${dataKey}.data.json`, { encoding: 'utf8' }))
        : defaultT ?? {};
export const dataExists = (dataKey: DataKey): boolean => existsSync(`./data/${dataKey}.data.json`);
export const writeData = async (dataKey: DataKey, data: any): Promise<void> =>
    promises.writeFile(`./data/${dataKey}.data.json`, JSON.stringify(data), { encoding: 'utf8' });

export function prepareForJSON<T>(obj: T): T {
    const clone = { ...obj };
    for (const [key, value] of Object.entries(clone)) {
        if (value instanceof Map) {
            const arr = [];
            for (const entry of value.entries()) arr.push(entry);
            Object.defineProperty(clone, key, { value: arr, enumerable: true });
        }
    }
    return clone;
}

export const arrayLast = <T>(arr: T[]): T => arr[arr.length - 1];

export async function exhaustFeedUntil<T>(feed: Feed<any, T>, max: number = Number.MAX_VALUE): Promise<T[]> {
    let arr = [];
    do {
        arr = arr.concat(await feed.items());
    } while (feed.isMoreAvailable() && arr.length < max);
    return arr;
}

export const generateColorForUser = (id: BigInteger) => Chance(id.toString()).color();

export async function createDirectoriesFromTree(tree: Tree, baseUrl: string): Promise<void> {
    if (!Array.isArray(tree)) {
        for (const [key, value] of Object.entries(tree)) {
            await mkdir(join(baseUrl, key));
            await createDirectoriesFromTree(value, join(baseUrl, key));
        }
    } else {
        if (tree.length === 0) return;

        for (const dir of tree) {
            if (typeof dir === 'string') {
                await mkdir(join(baseUrl, dir));
            } else {
                await createDirectoriesFromTree(dir, baseUrl);
            }
        }
    }
}

export const getRemainingStringLength = (src: string, search: string) => src.toLowerCase().replace(search, '').length;

function mkdir(dir: PathLike): Promise<void> {
    if (!existsSync(dir)) {
        return promises.mkdir(dir);
    }
}
