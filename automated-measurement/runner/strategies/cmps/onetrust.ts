import {StrategyArgs} from "../index";
import {clickAll, iterateLocator, waitFor} from "../../utils/playwright";


export async function onetrustAccept({page, log}: StrategyArgs) {
    const acceptButton = page.locator(`
        #onetrust-accept-btn-handler:visible,
        .optanon-allow-all:visible,
        .optanon-button-allow:visible,
        #onetrust-pc-sdk #accept-recommended-btn-handler:visible
    `)
    await acceptButton.click();
    log("OneTrust dialog accepted.")
}

export async function onetrustReject({page, log}: StrategyArgs) {
    await page.waitForSelector(`
        #onetrust-pc-btn-handler:visible,
        #onetrust-pc-sdk:visible
    `);
    log("Found a OneTrust dialog.")


    await page.click("#onetrust-pc-btn-handler:visible", {timeout: 2000})
        .catch(log.err("OneTrust: No more options button."));

    const tabs = page.locator("#onetrust-consent-sdk .category-menu-switch-handler")
    const is_tabbed_layout = await waitFor(tabs, 2000).catch(_ => false);

    async function uncheck() {
        const buttons = page.locator(`
                .cookie-subgroup-handler:checked ~ label:visible,
                .category-switch-handler:checked ~ label:visible,
                .ot-obj-leg-btn-handler:visible
            `);
        await waitFor(buttons, 500).then(() => clickAll(buttons)).catch(_timeout => 0);
    }

    if (is_tabbed_layout) {
        for await (const tab of iterateLocator(tabs)) {
            await tab.click();
            await uncheck();
        }
    } else {
        const accordions = page.locator(`
            input[ot-accordion=true]:not(:checked),
            button[ot-accordion=true][aria-expanded=false]
        `);
        await waitFor(accordions, 500).then(() => clickAll(accordions))
            .catch(log.err("OneTrust non-tabbed: no accordion", false));
        await uncheck();

    }
    await page.click(`.ot-pc-refuse-all-handler:visible, .save-preference-btn-handler:visible`);
    log("OneTrust dialog rejected.");
}
