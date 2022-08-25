import {Device, MeasurementPlanV3, Region} from "../main";
import strategies from "../strategies";
import collections from "../collections";
import {AWS_S3, localeForRegion, timezoneForRegion} from "../utils/utils";


if (require.main === module) {

    const cmps: (keyof typeof collections)[] = [
        "cmp_onetrust",
        "cmp_quantcast",
        "cmp_sourcepoint"
    ];
    const consent_strats: (keyof typeof strategies)[] = [
        "consent_accept",
        "consent_reject"
    ];
    const regions: Region[] = [
        "eu-central-1",
        "eu-west-1"
    ];
    const devices: Device[] = [
        {type: "chromium", profile: "Desktop Chrome"},
        {type: "firefox", profile: "Desktop Firefox"},
        {type: "webkit", profile: "Desktop Safari"},
        {type: "chromium", profile: "Pixel 5"}
    ];

    const idPrefix = `consent-test/${new Date().toISOString().substring(0, 16)}`

    const plans: MeasurementPlanV3[] = []
    for (const cmp of cmps) {
        for (const strategy of consent_strats) {
            for (const region of regions) {
                for (const device of devices) {
                    plans.push({
                        version: 3,
                        id: `${idPrefix}-${String(plans.length).padStart(2, "0")}`,
                        region,
                        device,
                        locale: localeForRegion(region),
                        timezone: timezoneForRegion(region),

                        concurrency: 1,

                        log: {
                            console: true,
                        },

                        prime: {urls: [], strategy: "idle"},
                        measure: {
                            urls: {
                                collection: cmp,
                                pages: 100,
                            },
                            strategy
                        },
                        store: AWS_S3
                    })
                }
            }
        }
    }
    console.log(JSON.stringify(plans));
}
