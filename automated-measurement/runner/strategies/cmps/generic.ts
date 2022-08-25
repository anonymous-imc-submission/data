import {StrategyArgs} from "../index";

import * as consent_patterns from "../../utils/consent_patterns.json";
import {withTimeout} from "../../utils/utils";
import {ElementHandle} from "playwright";


export async function genericAccept({page, log}: StrategyArgs) {
    log(`Trying generic consent accept on page with ${page.frames().length} frames.`)
    const selectorAccept = "text=/" + consent_patterns.accept.join("|") + "/i";
    const selectorSave = "text=/" + consent_patterns.save.join("|") + "/i";

    let found = false;
    await withTimeout(Promise.allSettled(page.frames().map(async (frame, i) => {
        for (const selector of [selectorAccept, selectorSave]) {
            const elems: { text: string, elem: ElementHandle }[] = [];
            for (const elem of await frame.$$(selector).catch(e => [])) {
                let text = await elem.textContent() || "!could not obtain textContent!";
                text = text.replaceAll(/\s+/g, " ").trim();
                elems.push({elem, text});
            }
            if (elems.length > 0) {
                found = true;
                elems.sort((a,b) => a.text.length - b.text.length);
                for(const e of elems) {
                    log(`Clicking in frame ${i}: ${e.text}`)
                    try {
                        await e.elem.click({timeout: 7_000})
                        return
                    } catch(e) {
                        log.err("Failed to click")(e);
                    }
                }
            }
        }
    })), 30_000);
    if (!found) {
        log("Found no matching elements.");
    }
}


export async function genericReject(args: StrategyArgs) {
    throw "not implemented"
}
