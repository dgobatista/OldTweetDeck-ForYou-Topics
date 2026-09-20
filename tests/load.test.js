// Runs src/interception.js top-level code in a stubbed browser-like sandbox to
// catch load-time errors (typos, TDZ, bad literals) that would kill the extension
// on every page load, and checks the algorithmic timeline registry it builds.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "src", "interception.js");
const src = fs.readFileSync(SRC, "utf8");

let failures = 0;
const check = (label, ok, detail) => {
    console.log((ok ? "PASS " : "FAIL ") + label + (detail === undefined ? "" : "  -> " + detail));
    if (!ok) failures++;
};

const noop = () => {};
const el = () => ({
    appendChild: noop, addEventListener: noop, setAttribute: noop,
    style: {}, dataset: {}, querySelector: () => null,
});

const store = {};
const localStorage = new Proxy(store, {
    get: (t, k) =>
        k === "getItem" ? (x) => (x in t ? t[x] : null)
        : k === "setItem" ? (x, v) => { t[x] = String(v); }
        : k === "removeItem" ? (x) => { delete t[x]; }
        : t[k],
    set: (t, k, v) => { t[k] = String(v); return true; },
});

const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    localStorage,
    location: { hostname: "x.com", href: "https://x.com/i/tweetdeck", origin: "https://x.com" },
    document: {
        cookie: "", querySelector: () => null, querySelectorAll: () => [],
        createElement: el, addEventListener: noop, head: el(), body: el(),
    },
    navigator: { userAgent: "node" },
    XMLHttpRequest: function () {},
    MutationObserver: function () { this.observe = noop; },
    ProgressEvent: function () {},
    Event: function () {},
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    URL, URLSearchParams, BigInt, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    fetch: () => new Promise(noop),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

const PROBE = `
;globalThis.__probe = {
    algoTimelines, ALGO_TOPIC_CATALOG, buildAlgoList, listIdForTopic,
    FORYOU_LIST_ID, rememberTweet, wasTweetSeen, seenHomeTweets, SEEN_TWEETS_PER_FEED,
    HOME_TIMELINE_QUERY_ID,
};`;

try {
    vm.runInNewContext(src + PROBE, sandbox, { filename: "interception.js" });
    check("interception.js loads", true);
} catch (e) {
    check("interception.js loads", false, e && e.message);
    console.log(e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e);
    process.exit(1);
}

const p = sandbox.__probe;

// --- the synthetic timelines the column picker offers ---
check("topic catalog is populated", p.ALGO_TOPIC_CATALOG.length > 0, p.ALGO_TOPIC_CATALOG.length + " topics");
check(
    "every catalog topic is registered, plus For you",
    p.algoTimelines.size === p.ALGO_TOPIC_CATALOG.length + 1,
    p.algoTimelines.size + " timelines"
);
check("catalog has no duplicate tags", new Set(p.ALGO_TOPIC_CATALOG.map((t) => t.tag)).size === p.ALGO_TOPIC_CATALOG.length);
check("catalog has no duplicate names", new Set(p.ALGO_TOPIC_CATALOG.map((t) => t.name)).size === p.ALGO_TOPIC_CATALOG.length);
check("reserved list ids are unique", new Set(p.algoTimelines.keys()).size === p.algoTimelines.size);

const forYou = p.buildAlgoList(p.FORYOU_LIST_ID);
check("For you list has no tag (plain algorithmic feed)", p.algoTimelines.get(p.FORYOU_LIST_ID).tag === null);
check("For you list is well formed", Boolean(forYou.id_str && forYou.name && forYou.slug && forYou.user.id_str));
check(
    "the fake owner is not a real account id",
    forYou.user.id_str === "1" && typeof forYou.user.profile_image_url_https === "string" && forYou.user.profile_image_url_https.length > 0
);

const topicId = [...p.algoTimelines.keys()].find((k) => k !== p.FORYOU_LIST_ID);
const topic = p.buildAlgoList(topicId);
check("topic list is well formed", Boolean(topic.id_str && topic.name && topic.slug && p.algoTimelines.get(topicId).tag));

// --- topic ids must not depend on the catalog's order ---
// A saved column stores the list id, so an id that shifts when the catalog is
// reordered silently repoints that column at a different topic.
const idsInOrder = p.ALGO_TOPIC_CATALOG.map((t) => p.listIdForTopic(t.tag));

const reversed = {};
const sandbox2 = { ...sandbox, localStorage: new Proxy(reversed, { set: (t, k, v) => ((t[k] = String(v)), true) }) };
sandbox2.window = sandbox2; sandbox2.self = sandbox2; sandbox2.globalThis = sandbox2;
vm.runInNewContext(src + PROBE, sandbox2, { filename: "interception.js" });
const p2 = sandbox2.__probe;
const sameMapping = p.ALGO_TOPIC_CATALOG.every((t, i) => idsInOrder[i] === p2.listIdForTopic(t.tag));
check("two fresh installs agree on every topic id", sameMapping);

// The old scheme handed ids out as a running counter, so they marched in step
// with the catalog: inserting a topic in the middle shifted everything after it.
// Ids derived from the tag do not line up that way.
const base = BigInt(idsInOrder[0]);
const sequential = idsInOrder.every((id, i) => BigInt(id) === base + BigInt(i));
check("topic ids do not follow the catalog's order", !sequential);

// A saved column stores the list id, so ids already handed out must never move.
const kept = { "1925949722688126976": "900000000000010", "1925953013547450368": "900000000000011" };
const seeded = { OTDalgoTopics: JSON.stringify(kept) };
const sandbox3 = { ...sandbox, localStorage: new Proxy(seeded, { set: (t, k, v) => ((t[k] = String(v)), true) }) };
sandbox3.window = sandbox3; sandbox3.self = sandbox3; sandbox3.globalThis = sandbox3;
vm.runInNewContext(src + PROBE, sandbox3, { filename: "interception.js" });
const p3 = sandbox3.__probe;
check(
    "ids already on disk are preserved",
    Object.entries(kept).every(([tag, id]) => p3.listIdForTopic(tag) === id)
);
check("preserved ids still resolve to the right timelines", Object.values(kept).every((id) => p3.algoTimelines.has(id)));

// --- the HomeTimeline query id must be overridable without a release ---
check("a HomeTimeline query id is set", Boolean(p.HOME_TIMELINE_QUERY_ID));
const overridden = { OTDhomeTimelineQueryId: "OverrideMe123" };
const sandbox4 = { ...sandbox, localStorage: new Proxy(overridden, { set: (t, k, v) => ((t[k] = String(v)), true) }) };
sandbox4.window = sandbox4; sandbox4.self = sandbox4; sandbox4.globalThis = sandbox4;
vm.runInNewContext(src + PROBE, sandbox4, { filename: "interception.js" });
check("localStorage overrides the query id", sandbox4.__probe.HOME_TIMELINE_QUERY_ID === "OverrideMe123");

// --- the seen-tweets cache must not grow without bound ---
const cap = p.SEEN_TWEETS_PER_FEED;
for (let i = 0; i < cap + 500; i++) p.rememberTweet("test-feed", "id" + i);
check("seen tweets are capped per feed", p.seenHomeTweets["test-feed"].size <= cap, p.seenHomeTweets["test-feed"].size + " / " + cap);
check("the newest id is still remembered", p.wasTweetSeen("test-feed", "id" + (cap + 499)));
check("the oldest id was evicted", !p.wasTweetSeen("test-feed", "id0"));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
