// Loads src/interception.js in a sandbox, then drives the OpenColumnHome wrapper
// against a fake component to check that the "For you & Topics" tile is added to
// the column-type modal without disturbing what bundle.js expects to find there.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "interception.js"), "utf8");
const noop = () => {};
let failures = 0;
const check = (label, ok) => {
    console.log((ok ? "PASS " : "FAIL ") + label);
    if (!ok) failures++;
};

// --- minimal fake DOM, just enough for addForYouTile ---
function fakeEl(tag) {
    return {
        tagName: tag,
        className: "",
        dataset: {},
        children: [],
        listeners: {},
        _html: "",
        set innerHTML(v) {
            this._html = v;
            this.children = [];
            if (/<a /.test(v)) this.children.push(fakeEl("a"));
        },
        get innerHTML() { return this._html; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
        insertBefore(c, ref) {
            const i = this.children.indexOf(ref);
            this.children.splice(i < 0 ? this.children.length : i, 0, c);
            c.parentElement = this;
            return c;
        },
        querySelector(sel) {
            if (sel === "a") return this.children.find((c) => c.tagName === "a") || null;
            if (sel === '[data-type="otd-foryou"]') return this.children.find((c) => c.dataset.type === "otd-foryou") || null;
            if (sel === "li.js-item-launch:not(.top-row)")
                return this.children.find((c) => /js-item-launch/.test(c.className) && !/top-row/.test(c.className)) || null;
            return null;
        },
    };
}

const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    localStorage: new Proxy({}, { set: (t, k, v) => ((t[k] = String(v)), true) }),
    location: { hostname: "x.com", href: "https://x.com/i/tweetdeck", origin: "https://x.com" },
    document: { cookie: "", querySelector: () => null, querySelectorAll: () => [], createElement: fakeEl, addEventListener: noop },
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

vm.runInNewContext(src + "\n;globalThis.__install = installForYouLauncherTile;", sandbox, { filename: "interception.js" });
check("interception.js loads", typeof sandbox.__install === "function");

// --- stand-in for bundle.js's component: the 4 top-row tiles plus List ---
function Home() {
    const grid = fakeEl("ul");
    grid.className = "lst-launcher cf";
    for (const t of ["home", "usertimeline", "interactions", "search"]) {
        const li = fakeEl("li");
        li.className = "js-item-launch top-row";
        li.dataset.type = t;
        grid.appendChild(li);
    }
    const list = fakeEl("li");
    list.className = "js-item-launch";
    list.dataset.type = "lists";
    grid.appendChild(list);
    this.$node = [grid];
}
Home.prototype.destroy = function () { return "destroyed"; };
// worst case: statics defined as non-enumerable own properties
Object.defineProperty(Home, "URL_BASE", { value: "/add", enumerable: false });
Object.defineProperty(Home, "DATAMINR_ADD_SELECTOR", { value: '.js-item-launch[data-type="dataminr"]', enumerable: false });

sandbox.TD = { components: { OpenColumnHome: Home } };
sandbox.__install();

const Wrapped = sandbox.TD.components.OpenColumnHome;
check("constructor was replaced", Wrapped !== Home && Wrapped.__otdWrapped === true);
check("static URL_BASE passes through", Wrapped.URL_BASE === "/add");
check("static DATAMINR_ADD_SELECTOR passes through", Wrapped.DATAMINR_ADD_SELECTOR === '.js-item-launch[data-type="dataminr"]');

const home = new Wrapped();
const grid = home.$node[0];
const types = grid.children.map((c) => c.dataset.type);
check("instance keeps prototype methods", home.destroy() === "destroyed");
check("instanceof the original still holds", home instanceof Home);
check("tile inserted exactly once", types.filter((t) => t === "otd-foryou").length === 1);
check("tile is first of the second row, before List", types[4] === "otd-foryou" && types[5] === "lists");
check("top row untouched", types.slice(0, 4).join() === "home,usertimeline,interactions,search");
check("tile has a click handler", typeof grid.children[4].querySelector("a").listeners.click === "function");

sandbox.__install();
check("installing twice is a no-op", sandbox.TD.components.OpenColumnHome === Wrapped);

const home2 = new sandbox.TD.components.OpenColumnHome();
check("every new modal gets the tile", home2.$node[0].children.filter((c) => c.dataset.type === "otd-foryou").length === 1);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
