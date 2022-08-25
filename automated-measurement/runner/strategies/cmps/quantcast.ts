import {StrategyArgs} from "../index";

function quantcastCommon({page, log}: StrategyArgs) {
    // Modify QuantCast's dialog's z-index so that we see debugging helpers.
    page.locator(".qc-cmp-cleanslate")
        .evaluate((node: HTMLElement) => node.style.zIndex = "2147483646")
        .then(() => log("Found a Quantcast dialog!"))
        .catch(_ => 0);
}

export async function quantcastAccept(args: StrategyArgs) {
    const {page, log} = args;
    quantcastCommon(args);

    await page.click(".qc-cmp2-footer button[mode=primary]");
    log("Quantcast dialog accepted.")
}

export async function quantcastReject(args: StrategyArgs) {
    const {page, log} = args;
    quantcastCommon(args);

    // more options
    await page.locator(".qc-cmp2-footer button[mode=secondary]:visible").last().click();

    // legitimate interest
    await page.locator(".qc-cmp2-footer button[mode=link]:visible").last().click();

    // object all
    await page.locator(`
        .qc-cmp2-footer button[mode=secondary]:visible,
        .qc-cmp2-header-links button[mode=link]:first-child:visible
    `).first().click();

    // save all
    await page.click(".qc-cmp2-footer button[mode=primary]:visible");
    log("Quantcast dialog rejected.")
}
