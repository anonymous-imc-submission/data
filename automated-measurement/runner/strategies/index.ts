import * as interact from "./interact";
import * as measure from "./consent";
import {Page} from "playwright";
import {LogFn} from "../utils/utils";


export type StrategyArgs = {
    url: string
    page: Page
    log: LogFn
    store: (filename, json) => Promise<void>
}

const strategies = {
    ...interact,
    ...measure,
};

export default strategies as Record<keyof typeof strategies, (StrategyArgs) => Promise<void>>;
