import chalk, {Color} from "chalk";
import {promisify} from "util";
import child_process from "child_process";
import {readdir, rename} from 'fs/promises';
import {Region, S3Config} from "../main";
import path from "path";
import {sample} from "lodash-es";

const exec = promisify(child_process.exec);


export const isDebugging = process.platform === "win32" || process.env.ADMEASURE_DEBUG;


export interface LogFn {
    (...args: any): void;

    err: (message: string, includeErr?: boolean) => (e: any) => false;

}

export interface LogFnWithHistory extends LogFn {
    history: LogMessage[]
}

export type LogMessage = {
    part: string
    text: string
    time: Date
}

export function makeLogFn(part: string, color: typeof Color, keepHistory: true | LogMessage[]): LogFnWithHistory;
export function makeLogFn(part: string, color: typeof Color, keepHistory?: false): LogFn;
export function makeLogFn(part: string, color: typeof Color, keepHistory: boolean | LogMessage[] = false): LogFn {
    const log = (...args: any) => {
        console.log.apply(console, [chalk[color](`[${part}]`), ...args]);
        log.history?.push({
            part: part,
            text: args.join(" "),
            time: new Date(),
        })
    };
    log.err = (message: string, includeErr: boolean = true) => {
        if (includeErr) {
            return (e: any): false => {
                if (e instanceof AggregateError) {
                    e = "\n  - " + e.errors.map(e => `${e}`.split("\n").join("\n    ")).join("\n  - ");
                }
                log(`${message}: ${e}`);
                return false;
            };
        } else {
            return (e: any): false => {
                log(message);
                return false;
            };
        }
    }
    log.history = keepHistory === false ? undefined : (keepHistory === true ? [] : keepHistory);
    return log
}


const run = async (cmd: string) => {
    console.log("$", cmd);
    const proc = exec(cmd);
    proc.child.stdout?.pipe(process.stdout);
    proc.child.stderr?.pipe(process.stderr);
    await proc;
}

async function getFiles(dir): Promise<string[]> {
    const dirents = await readdir(dir, {withFileTypes: true});
    const files: string[][] = await Promise.all(dirents.map(async (dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? await getFiles(res) : [res];
    }));
    return files.flat();
}

export const uploadS3 = async (s3: S3Config, from: string, to: string, log: LogFn) => {
    // we can't filter here because we upload all with a gzip content-encoding
    const files = await getFiles(from); //.filter(f => /\.(json|har)$/.exec(f));

    log(`Gzipping ${files.length} files...`);
    await Promise.all(files.map(async f => {
        await exec(`gzip -9 ${f}`);
        await rename(`${f}.gz`, f);
    }));

    log(`Uploading to S3...`);
    let endpoint = s3.endpoint ? `--endpoint ${s3.endpoint}` : "";
    let profile = s3.profile ? `--profile ${s3.profile}` : "";
    await run(`aws ${endpoint} ${profile} s3 cp --recursive --content-encoding gzip ${s3.args || ""} ${from} s3://${s3.bucket}/${to}`);

    if (isDebugging) {
        log(`Ungzipping ${files.length} files...`);
        await Promise.all(files.map(async f => {
            await rename(f, `${f}.gz`);
            await exec(`gzip -d ${f}.gz`);
        }));
    }
}

/**
 * Sleep for the specified amount of time.
 */
export function sleep(duration: number = 250): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, duration));
}


export async function retry<T>(fn: () => Promise<T>, log: LogFn, n: number = 3, backoff: number = 30_000): Promise<T> {
    let attempts = 0;
    while (true) {
        attempts++;
        try {
            return await fn();
        } catch (e) {
            if (attempts === n) {
                throw e;
            } else {
                log.err(`Backing off for ${backoff}ms...`)(e);
                await sleep(backoff);
                log("Retrying...");
            }
        }
    }
}

export function withTimeout<T>(promise: Promise<T> | (() => Promise<T>), timeout: number, timeoutMessage?: string): Promise<T> {
    if (!(promise instanceof Promise))
        promise = promise();
    return Promise.race([
        promise,
        new Promise<T>((resolve, reject) =>
            setTimeout(
                () => reject(timeoutMessage || `timeout after ${timeout}ms.`),
                timeout
            )
        )
    ]);
}

export class Instant {
    readonly timestamp: Date

    constructor() {
        this.timestamp = new Date();
    }

    elapsed(): string {
        let elapsed = new Date(+new Date() - +this.timestamp),
            ms = elapsed.getUTCMilliseconds(),
            s: string | number = elapsed.getUTCSeconds(),
            m = elapsed.getUTCMinutes(),
            h = elapsed.getUTCHours();

        if (!m && !h && s <= 10)
            s = (s + ms / 1000).toFixed(2);
        else if (!m && !h)
            s = (s + ms / 1000).toFixed(1);

        let ret = `${s}s`;
        if (m || h)
            ret = `${m}m ` + ret;
        if (h)
            ret = `${h}h ` + ret;
        return ret;
    }

}


export const UKIE_REGIONS: Region[] = ["lon1", "eu-west-1"];

export function localeForRegion(region: Region): string {

    if (UKIE_REGIONS.includes(region)) {
        return "en-GB;q=0.9,en;q=0.8";
    } else {
        return "de-DE,de;q=0.9";
    }
}

export function timezoneForRegion(region: Region): string {
    if (UKIE_REGIONS.includes(region)) {
        return "Europe/London"
    } else {
        return "Europe/Berlin"
    }
}

export const AWS_S3: S3Config = {
    endpoint: "https://s3.eu-central-1.amazonaws.com",
    bucket: "admeasure",
    profile: "admeasure"
};
export const DIGITALOCEAN_S3: Omit<S3Config, "bucket"> = {
    endpoint: "https://fra1.digitaloceanspaces.com",
    profile: "admeasure-do"
};
export const random = {
    choice: function <T>(x: T[]): T {
        return sample(x)!;
    }
}
