import * as consent_patterns from "./consent_patterns.json";

const _toRegex = p => new RegExp(p, "i");
export const patterns = {
    accept: consent_patterns.accept.map(_toRegex),
    prefs: consent_patterns.prefs.map(_toRegex),
    legInt: consent_patterns.legInt.map(_toRegex),
    gvl: consent_patterns.gvl.map(_toRegex),
    save: consent_patterns.save.map(_toRegex),
}



export function findMatching<T extends { text: string }>(elems: T[], matchPatterns: RegExp[], avoidPatterns: RegExp[]): T {
    let known = new Set();
    elems.filter(elem => {
        let text = elem.text.trim().toLowerCase();
        if (!text || known.has(text)) {
            return false;
        }
        known.add(text);
        return true;
    })

    for (const elem of elems) {
        if (matchPatterns.some(pattern => pattern.exec(elem.text)))
            return elem;
    }

    let filtered = elems.filter(({text}) => !avoidPatterns.some(pattern => pattern.exec(text)));
    if (filtered.length === 1 && elems.length > 1) {
        return filtered[0];
    }

    throw `No matching button found: ${elems.map(e => e.text)}`;
}
