import {Instant, isDebugging, sleep} from "../utils/utils";
import {clamp, random, sample} from "lodash-es";
import {StrategyArgs} from "./index";
import {ElementHandle} from "playwright";

export async function idle({page, log}: StrategyArgs, min: number = 15_000, max: number = 45_000) {
    log(`Waiting...`);
    let start = new Instant();
    await sleep(min);
    log(`Slept for ${start.elapsed()}.`);

    // Note that we only check networkidle *after* the minimum wait time,
    // it may be true intermittedly and we don't want to exit early.
    await page.waitForLoadState("networkidle", {timeout: max - min})
        .then(
            _ => log(`Network is idle after ${start.elapsed()}.`),
            _ => log(`Timeout after ${start.elapsed()}`)
        );
}

export async function click(args: StrategyArgs) {
    const {page, log} = args;
    await idle(args, 7_000, 15_000);
    if (await clickLink()) {
        if (await clickLink()) {
            await clickLink();
        }
    }

    async function clickLink() {
        const links: ElementHandle<HTMLAnchorElement>[] = await page.$$("a:visible:not([target=_blank],[href^=mailto])") as ElementHandle<HTMLAnchorElement>[];
        const link = sample(links);
        if (link) {
            let text = await link.textContent() || "";
            log("Clicking random link: ", text.replaceAll(/\s+/g, " ").trim());

            await link.click({force: true, delay: 50})
                .then(() => idle(args, 2000, 7000))
                .catch(log.err("Failed to click link"));
            return true;
        } else {
            log("Page has no links.");
            return false;
        }
    }
}


async function scroll(args: StrategyArgs) {
    const {page, log} = args;
    for (let i = 0; i < 5; i++) {
        log("Scrolling down...");
        await page.press("body", "PageDown", {delay: 100, timeout: 5000})
            .catch(log.err("Cannot scroll"));
        await page.waitForLoadState("networkidle", {timeout: 2000})
            .catch(log.err("Network not idle yet, continuing anway", false));
    }
}

async function mouseMove(args: StrategyArgs, time: number) {
    const deadline = +new Date() + time
    const {page, log} = args;
    const dimensions = page.viewportSize();
    if (!dimensions)
        return log("Unable to get page dimensions");
    let x = random(0, dimensions.width),
        y = random(0, dimensions.height);

    await page.mouse.move(x, y);

    while (+new Date() < deadline) {
        x = clamp(x + random(-50, 50), 0, dimensions.width);
        y = clamp(y + random(-50, 50), 0, dimensions.width);
        log(`Moving cursor to {x: ${x}, y: ${y}}`)
        await page.mouse.move(x, y, {steps: isDebugging ? 3 : 20})
        await page.waitForTimeout(1000);
    }
}

export async function browse(args: StrategyArgs) {
    await idle(args, 5_000, 10_000);
    await Promise.all([
        scroll(args),
        mouseMove(args, 10_000)
    ]);
    await idle(args, 3_000, 10_000);
}
