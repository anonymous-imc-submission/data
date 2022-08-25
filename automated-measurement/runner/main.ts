import * as playwright from "playwright";
import {BrowserContext, BrowserType, chromium, devices, firefox, webkit} from "playwright";
import path from "path";
import strategies, {StrategyArgs} from "./strategies";
import collections from "./collections";

import * as fs from "fs/promises";
import Throttle from 'promise-parallel-throttle';
import {sampleSize} from "lodash-es";
import chalk from "chalk";
import publicIp from "public-ip";
import {Instant, isDebugging, makeLogFn, retry, sleep, uploadS3, withTimeout} from "./utils/utils";
import {getContents, logConsoleEvents} from "./utils/playwright";
import getFolderSize from "get-folder-size";
import * as os from "os";
import {Command} from 'commander';
import HarRecorder from "./har/recorder";
import {makeStealth} from "./utils/stealth";

export type ChromiumDevice = {
    type: "chromium"
    profile?: keyof typeof devices
    options?: Partial<Parameters<typeof chromium.launchPersistentContext>[1]>
}
export type FirefoxDevice = {
    type: "firefox"
    profile?: keyof typeof devices
    options?: Partial<Parameters<typeof firefox.launchPersistentContext>[1]>
}
export type WebkitDevice = {
    type: "webkit"
    profile?: keyof typeof devices
    options?: Partial<Parameters<typeof webkit.launchPersistentContext>[1]>
}
export type Device = ChromiumDevice | FirefoxDevice | WebkitDevice

export type DigitalOceanRegion = "fra1" | "lon1"
export type AWSRegion = "eu-central-1" | "eu-west-1"
export type UIBKRegion = "uibk-vm" | "uibk-desktop"
export type Region = AWSRegion | UIBKRegion | DigitalOceanRegion

export type S3Config = {
    bucket: string
    endpoint?: string
    profile?: string
    args?: string
}

export type MeasurementPlanV3 = {
    version: 3
    id: string

    region?: Region
    device?: Device
    locale?: string
    timezone?: string
    gpc?: boolean

    concurrency?: number
    switch_ip?: boolean // TODO
    clear_profile?: boolean

    log: {
        screenshot?: "full" | "screen" | false
        contents?: boolean
        cookies?: boolean
        accessibility_tree?: boolean
        har?: boolean
        video?: boolean
        console?: boolean
    }
    store: S3Config | false

    prime: JobConfig
    measure: JobConfig
}

type SampleSpec = {
    collection: keyof typeof collections
    pages: number
}

type JobConfig = {
    urls: SampleSpec | string[]
    strategy: keyof typeof strategies
}

const dataDir = path.resolve("./data");
const browserProfileDir = path.resolve("./profile");
let ips: Promise<[string | null, string | null]>;
let plan: MeasurementPlanV3;
const start = new Instant();


const program = new Command();
program
    .command("r")
    .alias("run")
    .option("--plan-file <filename>", "use this plan", "plan.json")
    .action(run);

program
    .command("t")
    .description("Test a strategy on a particular website.")
    .alias("test-strategy")
    .option("-u, --url <url>")
    .option("-s, --strategy <strategy>")
    .option("-b, --browser <browser>")
    .option("-r, --read [filenames...]")
    .action(test_strategy)

program.parse(process.argv);

async function cleanup() {
    await fs.rm(dataDir, {recursive: true, force: true, maxRetries: 3});
    await fs.mkdir(dataDir);
    await fs.rm(browserProfileDir, {recursive: true, force: true, maxRetries: 3});
    await fs.mkdir(browserProfileDir, {recursive: true, mode: 0o700});
}

async function test_strategy({url, strategy, browser, read}) {
    if (!strategies[strategy]) {
        console.error(`Unknown strategy ${strategy}.`)
        return
    }
    if(!url) {
        url = "https://example.com/";
    }

    let device: Device;
    if (browser === "firefox") {
        device = {type: "firefox", options: {headless: false}};
    } else if (browser === "chrome") {
        device = {type: "chromium", options: {channel: "chrome", headless:false}};
    } else if (browser) {
        throw `unknown device: ${browser}`;
    } else {
        device = {type: "chromium", options: {headless: false}};
    }

    await cleanup();

    plan = {
        version: 3,
        id: "testid",
        log: {
            screenshot: "full",
        },
        device,
        measure: {
            urls: [url],
            strategy
        },
        prime: {urls: [], strategy},
        store: false,
    }
    await doJob("measure");
    for (let filename of (read || [])) {
        makeLogFn("file", "cyan")(filename);
        let f = await fs.readFile(path.join(dataDir, "measure-00", filename));
        process.stdout.write(f);
    }
    process.exit(0);
}

async function run({planFile}) {
    planFile = path.resolve(planFile);
    plan = require(planFile);
    const log = makeLogFn("main", "cyan");

    // gather ip info now, this can run the background.
    ips = Promise.all([
        publicIp.v4({timeout: 3000}).catch(_ => null),
        !isDebugging ? publicIp.v6({timeout: 3000}).catch(_ => null) : Promise.resolve(null),
    ]);

    // Figure out which job to run
    let jobs: ("prime" | "measure")[] = [];
    if (!plan.switch_ip) {
        jobs = ["prime", "measure"];
    } else {
        throw "not implemented"
    }

    log("Setting up directories...");
    await cleanup();
    await fs.copyFile(planFile, path.join(dataDir, "plan.json"))

    // prime
    if (jobs.includes("prime")) {
        await doJob("prime");
    }

    // measure
    if (plan.clear_profile) {
        await fs.rm(browserProfileDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (jobs.includes("measure")) {
        await doJob("measure");
    }

    let size_mb: number = (await getFolderSize(dataDir)).size / 1024 ** 2;
    log(`Log size: ${size_mb.toFixed(2)}MB`);
    if (size_mb > 4096) {
        log("Too large, exiting with error.");
        process.exit(1);
    }

    const store = plan.store;
    if (store) {
        log("Uploading to S3...");
        let uploadTime = new Instant();
        // S3 may tell us to back off
        await retry(() => uploadS3(store, dataDir, plan.id, log), log)
            .catch(log.err("S3 Upload terminally failed"));
        log(`Upload complete after ${uploadTime.elapsed()}.`)
    }
    log(`Finished after ${start.elapsed()}.`)
    process.exit();
}


async function doJob(
    part: "prime" | "measure"
) {
    const log = makeLogFn("runner", "yellow", true);

    const urls: string[] = (() => {
        let u = plan[part].urls;
        if (u instanceof Array)
            return u;
        return sampleSize(collections[u.collection], u.pages);
    })();

    if (urls.length === 0) {
        log(`Nothing to ${part}.`)
        return
    }

    // Start browser
    log(`Starting ${plan.device?.options?.channel || plan.device?.type || "chromium"} browser...`);
    const extraHTTPHeaders = plan.gpc ? {"Sec-GPC": "1", "DNT": "1"} : undefined;

    const recordVideo = part === "measure" && plan.log.video ? {dir: path.join(os.tmpdir(), "admeasure-video")} : undefined;
    const device: Device = plan.device || {type: "chromium"};
    const launchOptions = {
        ...(device.profile ? devices[device.profile] : {}),
        ...(device.options || {})
    };
    const browserType: BrowserType = playwright[device.type];

    const launchBrowser = async () => await retry(
        async () => {
            const instance = await browserType.launchPersistentContext(
                browserProfileDir,
                {
                    extraHTTPHeaders,
                    locale: plan.locale,
                    recordVideo,
                    slowMo: isDebugging ? 1000 : undefined,
                    timezoneId: plan.timezone,
                    timeout: 120_000,
                    ...launchOptions,
                }
            )
            await makeStealth(plan, instance);
            return instance;
        },
        log
    );
    let lastRestart = 0;
    const browser = {
        _launch: Promise.resolve(),
        instance: await launchBrowser(),
        restart: async () => {
            if ((+new Date() - lastRestart) < 60_000) {
                log("Browser restart already in progress...")
            } else {
                log("Restarting browser...");
                lastRestart = +new Date();
                browser._launch = (async () => {
                    await withTimeout(browser.instance.close(), 30000)
                        .catch(log.err("Error closing browser"));
                    browser.instance = await launchBrowser();
                })();
            }
            await browser._launch;
            log("Browser restart complete.");
        }
    };

    const runningIds = new Set<string>();
    const queue = urls.map((url, i) => () => {
            const id = `${part}-${String(i).padStart(2, "0")}`;
            runningIds.add(id);
            return visitPage(browser, part, id, url).catch(e => {
                console.error(`Error visiting page ${id}: ${e}`);
                process.exit(1);
            }).finally(() => runningIds.delete(id));
        }
    );
    await Throttle.all(
        queue,
        {
            maxInProgress: plan.concurrency || 1,
            progressCallback: progress => {
                const running = runningIds.size > 0 ? ` Running: ${[...runningIds].join(", ")}` : ""
                log(
                    chalk.green(`${progress.amountDone} done,`),
                    chalk.yellow(`${progress.amountStarted - progress.amountDone} in progress,`),
                    chalk.red(`${urls.length - progress.amountStarted} todo`),
                    `after ${start.elapsed()}.${running}`
                );
            }
        });

    let storageState;
    if (plan.log.cookies) {
        log("get storage state...");
        storageState = await withTimeout(browser.instance.storageState(), 300_000)
            .catch(log.err("Error getting storage state"))
    } else {
        storageState = null;
    }


    log("close browser...");
    await withTimeout(browser.instance.close(), 30000)
        .catch(log.err("Error closing browser"));


    log("write log...");

    const [ipv4, ipv6] = await withTimeout(async () => {
        if (ips)
            return await ips
        return [null, null]
    }, 30_000).catch(() => {
        log.err("Error getting IPs");
        return [null, null]
    });

    const result = {
        urls,
        start: start.timestamp,
        end: new Date(),
        ipv4,
        ipv6,
        log: log.history,
        storageState,
    }
    await fs.writeFile(path.join(dataDir, `${part}.json`), JSON.stringify(result, null, 2));
    log("done.");
}

async function visitPage(
    browser: { instance: BrowserContext, restart: () => Promise<void> },
    part: "prime" | "measure",
    id: string,
    url: string
): Promise<boolean> {
    const log = makeLogFn(id, "green", true);

    const pageData = path.join(dataDir, id);
    await fs.mkdir(pageData, {recursive: true});
    const store = async (filename: string, json: any) => await fs.writeFile(
        path.join(pageData, filename),
        JSON.stringify(json, null, 2)
    );

    try {
        log(`opening new page...`);
        // this randomly fails, we restart the browser and retry
        let page;
        try {
            page = await retry(() => withTimeout(browser.instance.newPage(), 60_000), log, 2, 30_000);
        } catch (e) {
            await browser.restart();
            page = await withTimeout(browser.instance.newPage(), 60_000, "failed to open page");
        }
        logConsoleEvents(page, log);

        const recordHar = plan.log.har ? new HarRecorder(log, page, part === "measure" ? 1024 * 1024 : -1) : undefined;

        log(`visit ${url}...`);
        await page.goto(url, {waitUntil: "load"}).then(async () => {

            await page.waitForLoadState("domcontentloaded").catch(log.err("domcontentloaded timeout"));

            const args: StrategyArgs = {page, log, store, url};
            const strategy: (StrategyArgs) => Promise<void> = strategies[plan[part].strategy];

            await withTimeout(
                strategy(args),
                5 * 60_000,
                "Global timeout after 5min",
            ).catch(log.err(`Error executing ${plan[part].strategy} strategy`));

        }).catch(log.err("page load error"));

        if (part === "measure" && plan.log.screenshot) {
            await withTimeout(async () => {
                log("write out data: screenshot");
                await page.screenshot({
                    path: path.join(pageData, "screenshot.jpg"),
                    quality: 70,
                    type: "jpeg",
                    fullPage: plan.log.screenshot === "full",
                }).catch(log.err("Screenshot failed"));
            }, 30_000).catch(log.err("Error getting screenshot"));
        }

        if (part === "measure" && plan.log.contents) {
            log("write out data: contents");
            const contents = await getContents(page);
            await store("contents.json", contents);
        }

        if (part === "measure" && plan.log.cookies) {
            await withTimeout(async () => {
                log("write out data: cookies");
                const cookies = {
                    cookies: await page.context().cookies()
                        .catch(log.err("Error getting cookies")),
                    sessionStorage: await page.evaluate("({...sessionStorage})")
                        .catch(log.err("Cannot access sessionStorage")),
                    localStorage: await page.evaluate("({...localStorage})")
                        .catch(log.err("Cannot access localStorage")),
                };
                await store("cookies.json", cookies);
            }, 30_000).catch(log.err("Error getting cookies"));
        }

        if (part === "measure" && plan.log.accessibility_tree) {
            await withTimeout(async () => {
                // do this last because it likes to crash the browser
                log("write out data: accessibility");
                await page.accessibility.snapshot({interestingOnly: false})
                    .then(data => store("accessibility.json", data))
                    .catch(log.err("Error getting accessibility tree"));
            }, 30_000).catch(log.err("Error getting accessibility tree"));
        }

        if (recordHar) {
            log("write out data: har");
            const har = await recordHar.data();
            await store("requests.har", har);
        }

        log("closing page");
        await withTimeout(page.close(), 30_000).catch(log.err("Error closing page"));

        if (part === "measure" && plan.log.video) {
            await withTimeout(async () => {
                log("write out data: video");
                // super weird API where we need to delete after saveAs
                await page.video()?.saveAs(path.join(pageData, "video.webm")).catch(log.err("Error saving video"));
                await page.video()?.delete().catch(log.err("Error deleting video"));
            }, 30_000).catch(log.err("Error getting video"));
        }

        log("done.");
    } catch (e) {
        log(`Error visiting site: ${e}`);
    } finally {
        if (part === "measure" && plan.log.console) {
            await store("console.json", log.history);
        }
    }
    return false;
}
