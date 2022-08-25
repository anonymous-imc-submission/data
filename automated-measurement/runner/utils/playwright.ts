import {ElementHandle, Frame, Locator, Page} from "playwright";
import {LogFn, LogFnWithHistory, LogMessage, withTimeout} from "./utils";

type PageContents = { url: string, content: string | undefined }[];


/**
 * frame.content() times out for no particular reason, this works around this.
 */
export function getContents(page: Page): Promise<PageContents> {
    return Promise.all(
        page.frames().map(async frame => {
            const content = await withTimeout(frame.content(), 10_000).catch(e => undefined);
            return {
                url: frame.url(),
                content
            }
        })
    );
}

export type LogEntry = {
    type: string
    text: string
    location?: {
        url: string;
        lineNumber: number;
        columnNumber: number;
    }
}


export function logConsoleEvents(page: Page, log: LogFnWithHistory): void {
    page.on('console', msg => {
        if (process.env["CONSOLELOG"]) {
            log(`[console:${msg.type()}] ${msg.text()}`);
        }
        const loc = msg.location();
        log.history.push({
            part: `console.${msg.type()}`,
            text: `${msg.text()} @ ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`,
            time: new Date(),
        })
    });
}


export async function locatorList(l: Locator): Promise<Locator[]> {
    const n = await l.count();
    return [...Array(n)].map((_, i) => l.nth(i));
}

export async function* iterateLocator(l: Locator): AsyncIterable<Locator> {
    const n = await l.count();
    for (let i = 0; i < n; i++) {
        yield l.nth(i);
    }
}

export async function waitFor(locator: Locator, timeout: number = 30_000): Promise<true> {
    const handle = await locator.first().elementHandle({timeout});
    handle?.dispose();
    return true;
}

export async function waitForFrame(page: Page, condition: (frame: Frame) => boolean, timeout: number = 30_000): Promise<Frame> {
    return await new Promise((resolve, reject) => {
        const checkFrame = (frame: Frame) => {
            if (condition(frame)) {
                teardown();
                resolve(frame);
                return true;
            }
        }

        page.on("frameattached", checkFrame);
        page.on("framenavigated", checkFrame);

        const i = setInterval(() => page.frames().some(checkFrame), 1000);
        const t = setTimeout(() => {
            teardown();
            reject(`timeout waiting for frame: ${condition}`);
        }, timeout);

        const teardown = () => {
            page.removeListener("frameattached", checkFrame);
            page.removeListener("framenavigated", checkFrame);
            clearInterval(i);
            clearTimeout(t);
        }

        page.frames().some(checkFrame);
    });
}


export async function clickAll(locator: Locator) {
    const handles = await locator.elementHandles();
    for (const handle of handles) {
        await handle.click();
        await handle.dispose();
    }
}

export async function uncheckAll(locator: Locator, opts: Parameters<ElementHandle["uncheck"]>[0] = {}) {
    for (const handle of await locator.elementHandles()) {
        await handle.uncheck(opts);
        await handle.dispose();
    }
}
