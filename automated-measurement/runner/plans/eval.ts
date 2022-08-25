import {ChromiumDevice, Device, FirefoxDevice, MeasurementPlanV3, Region, WebkitDevice} from "../main";
import {AWS_S3, localeForRegion, random, timezoneForRegion, UKIE_REGIONS} from "../utils/utils";


const firefox: FirefoxDevice = {
    type: "firefox",
    options: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0",
        screen: {
            width: 1536,
            height: 864,
        },
        viewport: {
            width: 1536,
            height: 739,
        },
    }
};
const chrome: ChromiumDevice = {
    type: "chromium",
    options: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36",
        screen: {
            width: 1536,
            height: 864,
        },
        viewport: {
            width: 1536,
            height: 721,
        },
    }
};
const edge: ChromiumDevice = {
    type: "chromium",
    options: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Safari/537.36 Edg/94.0.992.38",
        screen: {
            "width": 1536,
            "height": 864,
        },
        viewport: {
            "width": 1536,
            "height": 763,
        },
        channel: "msedge",
    }
};
const webkit: WebkitDevice = {
    type: "webkit",
    options: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36",
        screen: {
            width: 1536,
            height: 864,
        },
        viewport: {
            width: 1536,
            height: 721,
        },
    }
}


export function makePlan(region: Region): MeasurementPlanV3 {
    const browsers: Device[] = [chrome, firefox, webkit];
    if (region === "uibk-desktop") {
        browsers.push(edge);
    }
    const device = random.choice(browsers);
    if (region === "uibk-desktop") {
        if (device.type === "chromium" && device.options?.channel === undefined)
            device.options = {
                ...device.options,
                channel: "chrome"
            }
        device.options = {
            ...device.options,
            headless: false
        };
    } else {
        device.options = {
            ...device.options,
            headless: random.choice([true, false])
        };
    }

    let concurrency = 1;
    if (region === "uibk-desktop" || region === "uibk-vm")
        concurrency = 3;

    let prime_collection, measure_collection;
    if (UKIE_REGIONS.includes(region)) {
        prime_collection = random.choice([
            "keyword_engagement_ukie",
            "search_engagement_ukie",
            "search_suv_ukie",
            "search_vaping_ukie",
            "search_weightloss_ukie"
        ]);
        measure_collection = "cmp_ukie";
    } else {
        prime_collection = random.choice([
            "keyword_engagement_dach",
            "search_engagement_dach",
            "search_suv_dach",
            "search_vaping_dach",
            "search_weightloss_dach"
        ]);
        measure_collection = "cmp_dach";
    }

    return {
        version: 3,
        id: `eval/${new Date().toISOString()}`,

        region,
        device,
        locale: localeForRegion(region),
        timezone: timezoneForRegion(region),
        concurrency,

        log: {
            screenshot: "screen",
            contents: true,
            cookies: true,
            accessibility_tree: true,
            har: true,
            console: true,
        },
        store: AWS_S3,

        prime: {
            urls: {
                collection: prime_collection,
                pages: random.choice([0, 0, 25, 50])
            },
            strategy: random.choice(["browse", "idle", "click", "consent_accept"])
        },
        measure: {
            urls: {
                collection: measure_collection,
                pages: 50
            },
            strategy: random.choice(["consent_accept", "consent_reject"])
        }
    };
}

if (require.main === module) {

    const [region]: string[] = process.argv.slice(2);
    if (region !== "uibk-desktop" && region !== "uibk-vm" && region !== "eu-central-1" && region != "eu-west-1") {
        throw `invalid region ${region}`
    }

    console.log(JSON.stringify(makePlan(region)));
}
