import {StrategyArgs} from "../index";
import {clickAll, iterateLocator, locatorList, waitFor, waitForFrame} from "../../utils/playwright";
import {Locator} from "playwright";
import {findMatching, patterns} from "../../utils/consent";
import {sleep} from "../../utils/utils";


async function sourcepointPopup({page, log, store}: StrategyArgs, matchPatterns: RegExp[], avoidPatterns: RegExp[]) {
    const frame = await waitForFrame(page, frame =>
        frame.url().includes("&consentUUID=")
    );
    log("Sourcepoint iframe found!");

    await frame.waitForSelector(".message-button:visible");
    let buttons = frame.locator(".message-button:visible");
    let buttonTexts = await buttons.allTextContents()
    await store("sourcepoint-modal.json", buttonTexts);

    const allButtons = buttonTexts.map((text, i) => ({
        button: buttons.nth(i),
        text: text.trim(),
    }));

    const btn = findMatching(allButtons, matchPatterns, avoidPatterns);
    await btn.button.click();
    log(`Button clicked: ${btn.text}`);
}


export async function sourcepointAccept(args: StrategyArgs) {
    const {log} = args;
    await sourcepointPopup(args, patterns.accept, patterns.prefs);
    log("Sourcepoint dialog accepted.");
}

export async function sourcepointReject(args: StrategyArgs) {
    const {page, store, log} = args;
    await sourcepointPopup(args, patterns.prefs, patterns.accept);
    const frame = await waitForFrame(page, (frame) =>
        frame.url().includes("&consentUUID=") && frame.url().includes("/privacy-manager")
    );
    log("Found Sourcepoint privacy manager.");

    const types = frame.locator(".pm-type-toggle div:visible");
    const buttons = frame.locator(".message-button:visible");
    const actions = frame.locator(".page-action:visible");
    await waitFor(buttons);
    await store("sourcepoint-manager.json", {
        types: await types.allTextContents(),
        buttons: await buttons.allTextContents(),
        actions: await actions.allTextContents(),
        actionParents: (await withTextContent(
            (await locatorList(actions)).map(x => x.locator(".."))
        )).map(e => e.text),
    });

    // First, iterate through the different types (consent, legint)
    const hasTypes = await waitFor(types, 2000).catch(_ => false);
    if (hasTypes) {
        log("Sourcepoint: toggling type toggles.");
        for await(const type of iterateLocator(types)) {
            await type.click();
            await toggleOffAll();
        }
    } else {
        log("Sourcepoint: no type toggles.");
        await toggleOffAll();
    }

    async function toggleOffAll() {
        const accordions = frame.locator(".accordion:not(.active)");
        await waitFor(accordions, 1000).then(() => clickAll(accordions)).catch(_timeout => 0);

        const toggles = frame.locator(".reject-toggle:not(.choice)");
        await waitFor(toggles, 1000).then(() => clickAll(toggles)).catch(_timeout => 0);

        const switches = frame.locator(`
            *[role=switch][aria-checked=true] span.slider,
            *[role=switch][aria-checked=true] span.off
        `);
        await waitFor(switches, 1000).then(() => clickAll(switches)).catch(_timeout => 0);
    }

    log("Sourcepoint: Check for legitimate interest button...");

    async function withTextContent(locators: Locator[]): Promise<{ text: string, locator: Locator }[]> {
        return await Promise.all(locators.map(async locator => {
            return {
                locator,
                text: await locator.textContent() || ""
            }
        }))
    }

    let action: { locator: Locator, text: string };
    try {
        try {
            let candidateActions = await withTextContent(await locatorList(actions));
            action = findMatching(candidateActions, patterns.legInt, patterns.gvl);
        } catch (e) {
            log("No immediate legitimate interest button found, trying parents...");
            let candidateActions = await withTextContent(
                (await locatorList(actions)).map(l => l.locator(".."))
            );
            action = findMatching(candidateActions, patterns.legInt, patterns.gvl);
            action.locator = action.locator.locator(".page-action:visible");
        }
        log(`Clicking legitimate interest button: ${action.text}`)
        await action.locator.click();
        await toggleOffAll();
    } catch (e) {
        log(`Sourcepoint: no legitimate interest button found: ${e}`);
    }

    // third, find the save button
    log("Sourcepoint: Find the save button.");
    const allButtons = (await buttons.allTextContents()).map((text, i) => ({
        button: buttons.nth(i),
        text: text.trim(),
    }));
    await findMatching(allButtons, patterns.save, patterns.accept).button.click();
    log("Sourcepoint dialog rejected.");
}
