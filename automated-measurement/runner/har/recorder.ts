// adapted from https://github.com/microsoft/playwright/blob/6a3d2b9fb94716c5feb3db89721ad2caa4243a83/src/server/supplements/har/harTracer.ts

import * as playwright from "playwright";
import * as har from "har-format";
import {LogFn} from "../utils/utils";


const HTTP_VERSION_UNKNOWN = "HTTP/x.x";

const emptyResponse: har.Response = {
    comment: "no known response",
    status: -1,
    statusText: '',
    httpVersion: HTTP_VERSION_UNKNOWN,
    cookies: [],
    headers: [],
    content: {
        size: -1,
        mimeType: 'x-unknown',
    },
    headersSize: -1,
    bodySize: -1,
    redirectURL: '',
}

export default class HarRecorder {
    private page: playwright.Page;
    private maxSize: number;
    private log: LogFn;

    private entrySymbol: symbol;
    private entries: har.Entry[];

    constructor(log: LogFn, page: playwright.Page, maxSize: number) {
        this.log = log;
        this.page = page;
        this.maxSize = maxSize;

        page.on("request", this.onRequest);
        page.on("response", this.onResponse);

        this.entrySymbol = Symbol('requestHarEntry');
        this.entries = [];
    }

    private entryForRequest = (request: playwright.Request): har.Entry | undefined => {
        return (request as any)[this.entrySymbol];
    }

    private onRequest = (request: playwright.Request) => {
        const url = request.url();
        if (!url)
            return;

        const harEntry: har.Entry = {
            // @ts-ignore
            comment: request.frame().guid,
            startedDateTime: new Date().toISOString(),
            time: -1,
            request: {
                method: request.method(),
                url,
                httpVersion: HTTP_VERSION_UNKNOWN,
                cookies: [],
                headers: [],
                queryString: [],
                postData: undefined,
                headersSize: -1,
                bodySize: -1,
            },
            response: emptyResponse,
            cache: {},
            timings: {send: -1, wait: -1, receive: -1},
        };
        if (this.maxSize > 0 && request.postDataBuffer()) {
            (async () => {
                const sizes = await request.sizes();
                if (0 < sizes.requestBodySize && sizes.requestBodySize < this.maxSize) {
                    const mimeType = await request.headerValue("content-type") || "";
                    harEntry.request.postData = {
                        mimeType,
                        text: request.postData()!,
                    }
                }
            })().catch(this.log.err("couldn't get request body"));
        }
        if (this.maxSize > -1) {
            request.headersArray().then((headers) => {
                harEntry.request.headers = headers;
            }).catch(this.log.err("Error getting request headers"));
        }

        if (request.redirectedFrom()) {
            const fromEntry = this.entryForRequest(request.redirectedFrom()!);
            if (fromEntry)
                fromEntry.response.redirectURL = request.url();
        }
        (request as any)[this.entrySymbol] = harEntry;
        this.entries.push(harEntry);
    }


    private onResponse = (response: playwright.Response) => {
        const harEntry = this.entryForRequest(response.request());

        if (!harEntry)
            return;

        harEntry.response = {
            status: response.status(),
            statusText: response.statusText(),
            httpVersion: HTTP_VERSION_UNKNOWN,
            cookies: [],
            headers: [],
            content: {
                size: -1,
                mimeType: "x-unknown",
            },
            headersSize: -1,
            bodySize: -1,
            redirectURL: "",
        };
        if (this.maxSize > 0) {
            (async () => {
                const size = (await response.request().sizes()).responseBodySize;
                const mimeType = await response.headerValue("content-type") || "";
                if (size === 0 || (300 <= response.status() && response.status() < 400)) {
                    harEntry.response.content = {
                        mimeType: "",
                        size: 0
                    }
                } else if (
                    /^(image|video|audio|font|text\/(css|javascript)|application\/(x-)?javascript)/i.exec(mimeType)
                    ||
                    /\.(png|jpe?g|webm|mp4|gif|ttf|woff)$/i.exec(response.request().url())
                ) {
                    harEntry.response.content = {
                        mimeType: "x-image-skipped",
                        size
                    }
                } else if (size > this.maxSize) {
                    harEntry.response.content = {
                        mimeType: "x-too-large",
                        size
                    }
                } else {
                    const text = await response.text();
                    harEntry.response.content = {
                        mimeType,
                        size,
                        text,
                    }
                }

            })().catch(this.log.err(`Error getting response body:\n${response.url()}\n${response.status()} ${response.statusText()}`));
        }
        (async () => {
            harEntry.response.headers = await response.headersArray();
        })().catch(this.log.err("Error getting response headers"));
    }

    data = async (): Promise<har.Har> => {
        return {
            log: {
                version: "1.2",
                creator: {
                    name: "admeasure",
                    version: "2",
                },
                entries: this.entries,
            }
        };
    }
}
