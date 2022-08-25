import {idle} from "./interact";
import {EventStatus, PingReturn, TCData, TCFAPI} from "@mdnx/tcf-types";
import {StrategyArgs} from "./index";
import {quantcastAccept, quantcastReject} from "./cmps/quantcast";
import {sourcepointAccept, sourcepointReject} from "./cmps/sourcepoint";
import {onetrustAccept, onetrustReject} from "./cmps/onetrust";
import {genericAccept, genericReject} from "./cmps/generic";


declare let window: Window & TCFAPI;

type ConsentResults = {
    version: 3
    strategy: "consent_accept" | "consent_reject"
    url: string
    hasTcfApi: boolean
    tcData: {
        [status in EventStatus | "failed"]?: TCData
    }
    pingWaiting: PingReturn | null
    pingLoaded: PingReturn | null
    consent: boolean | null
    legInt: boolean | null
    cmpId: number | null
}

async function getTCData({page, log}: StrategyArgs, results: ConsentResults): Promise<void> {
    let abort = false;
    await Promise.race([
        new Promise(((resolve, reject) => {
            setTimeout(() => {
                abort = true;
                reject("getTCData timed out")
            }, 120_000)
        })),
        (async () => {

            let ok = true;

            while (!results.tcData.useractioncomplete && !results.tcData.tcloaded && !abort) {

                if (!ok) {
                    // the last evaluation has crashed (hopefully because of a navigation change),
                    // we now wait for the page to be stable again.
                    log("TC data: waiting for page to stabilize...");
                    await page.waitForNavigation({timeout: 5_000, waitUntil: "load"}).catch(_ => 0);
                    await page.waitForFunction("!!window.__tcfapi").catch((e) => {
                        log(`__tcfapi not found anymore: ${e}`);
                        abort = true;
                    })
                }

                log("Trying to get more TC data...");
                ok = await page.evaluate(
                    (known_keys) => {
                        return new Promise((resolve, reject) => {
                            let listenerId: number | undefined = undefined;

                            const onEvent = async function (tcData: TCData, success: boolean) {
                                listenerId = listenerId || tcData.listenerId;
                                const key = success ? tcData.eventStatus : "failed";
                                if (!known_keys.includes(key)) {
                                    cleanup();
                                    resolve({tcData, success});
                                }
                            };

                            const cleanup = () => {
                                if (listenerId !== undefined)
                                    try {
                                        window.__tcfapi("removeEventListener", 2, () => 0, listenerId);
                                    } catch (e) {
                                        console.error("__tcfapi.removeEventListener failed", e);
                                    }
                            };

                            window.setTimeout(() => {
                                // Some CMPs screw up addEventListener, so we explicitly try getTCData here again.
                                setTimeout(() => {
                                    cleanup();
                                    reject("timeout")
                                }, 500);
                                try {
                                    window.__tcfapi("getTCData", 2, onEvent);
                                } catch (e) {
                                    console.error("__tcfapi.getTCData failed", e);
                                }
                            }, 50_000);
                            try {
                                window.__tcfapi("addEventListener", 2, onEvent);
                            } catch (e) {
                                console.error("__tcfapi.addEventListener failed", e);
                            }
                        });
                    },
                    Object.keys(results.tcData)
                ).then(({tcData, success}) => {
                    if (success) {
                        results.tcData[tcData.eventStatus] = tcData;
                    } else {
                        results.tcData.failed = tcData;
                    }
                    return true;
                }).catch(log.err("TC Data evaluation failed"));
            }
        })()
    ]);
}

async function logConsentInfo(args: StrategyArgs, strategy: "consent_accept" | "consent_reject"): Promise<boolean> {
    const {page, log, store, url} = args;

    const results: ConsentResults = {
        version: 3,
        strategy,
        url,
        tcData: {},
        hasTcfApi: false,
        pingWaiting: null,
        pingLoaded: null,
        consent: null,
        legInt: null,
        cmpId: null,
    };
    log("Waiting for __tcfapi...");

    /* careful: no imports of any kind here, this is evaluated on the page */
    if (await page.waitForFunction("!!window.__tcfapi").catch(log.err("__tcfapi not found"))) {
        log("__tcfapi found! Querying status...");
        results.hasTcfApi = true;

        const pingWaiting = (async () => {
            results.pingWaiting = await page.evaluate(() => {
                let ret: PingReturn | null = null;
                window.__tcfapi("ping", 2, (data: PingReturn) => {
                    if (!data.cmpLoaded)
                        ret = data
                });
                return ret as unknown as PingReturn
            }).then((val: PingReturn) => {
                log("Got pingWaiting.")
                return val
            }).catch(err => {
                log(`Error getting pingWaiting: ${err}`);
                return null;
            });
        })();
        const pingLoaded = (async () => {
            results.pingLoaded = await page.evaluate(() => {
                return new Promise((resolve, reject) => {
                    let ping = () => {
                        window.__tcfapi("ping", 2, function (pingReturn: PingReturn) {
                            if (pingReturn && pingReturn.cmpLoaded) {
                                resolve(pingReturn);
                                window.clearInterval(cancel);
                            }
                        });
                    };
                    setTimeout(() => reject("timeout"), 60_000);
                    let cancel = window.setInterval(ping, 100);
                    ping();
                });
            }).then((val: PingReturn) => {
                log("Got pingLoaded.")
                return val
            }).catch(err => {
                log(`Error getting pingLoaded: ${err}`);
                return null;
            });
        })();

        const tcData = getTCData(args, results)
            .then(() => log("TCF data obtained!"))
            .catch(log.err("Cannot get TCF data"));

        await Promise.allSettled([pingWaiting, pingLoaded, tcData]);
    }

    const tcData = results.tcData.useractioncomplete || results.tcData.tcloaded;
    results.consent = tcData?.purpose?.consents
        ? Object.values(tcData.purpose.consents).filter(x => x).length > 0
        : null;
    results.legInt = tcData?.purpose?.legitimateInterests
        ? Object.values(tcData.purpose.legitimateInterests).filter(x => x).length > 0
        : null;
    results.cmpId = tcData?.cmpId || results.pingLoaded?.cmpId || results.pingWaiting?.cmpId || null;
    log(`TCF data: cmpId ${results.cmpId} consent ${results.consent}, legInt ${results.legInt}.`);
    await store("consent.json", results);
    return results.consent !== null;
}

export async function consent_accept(args: StrategyArgs) {
    const {log} = args;
    log("Looking for dialogs to accept...");
    Promise.any([
        quantcastAccept(args),
        onetrustAccept(args),
        sourcepointAccept(args),
    ]).catch(e => {
        log.err("dialog accept failed")(e);
        return genericAccept(args)
            .catch(log.err("generic dialog accept failed"));
    })
    if(await logConsentInfo(args, "consent_accept"))
        await idle(args, 20_000, 45_000);
}

export async function consent_reject(args: StrategyArgs) {
    const {log} = args;
    log("Looking for dialogs to reject...");
    Promise.any([
        quantcastReject(args),
        onetrustReject(args),
        sourcepointReject(args),
    ]).catch(e => {
        log.err("dialog reject failed")(e);
        return genericReject(args)
            .catch(log.err("generic dialog reject failed"));
    })
    if(await logConsentInfo(args, "consent_reject"))
        await idle(args, 20_000, 45_000);
}
