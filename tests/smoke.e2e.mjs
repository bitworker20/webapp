// Browser smoke test for the web client: risk gate -> key import -> the shared
// poker page, ending with a gamecore selfTest inside the Web Worker.
//
// The selfTest is the point of this script. Unit tests cover the crypto and the
// transaction encoding, but only a real browser proves the parts that are pure
// deployment: that pokerWorker.bundle.js is reachable at the site root, that it
// can importScripts("gamecore.js"), and that the wasm instantiates under the
// page's CSP. Those broke silently every previous time the bundling changed.
//
// Usage:
//   npm run build
//   node tests/smoke.e2e.mjs            # serves dist/ itself
//   BASE_URL=http://host:port node tests/smoke.e2e.mjs
//
// Requires google-chrome on PATH (or CHROME_PATH) and puppeteer-core, which is
// borrowed from the keplr-wallet workspace rather than added as a dependency of
// this app — it is a dev-only tool and this client keeps its own dependency
// tree small on purpose.
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(
  join(root, "../keplr-wallet/node_modules/puppeteer-core/package.json")
);
const puppeteer = require("puppeteer-core");

// Same account the unit tests use (see src/wallet/armor.spec.ts).
const FIXTURE_PASSPHRASE = "testpass123";
const FIXTURE_ADDRESS = "xpoker1uflvlfueyjkvpfmtgyzt6txskpqn3qchu5kqch";
const FIXTURE_ARMOR = `-----BEGIN TENDERMINT PRIVATE KEY-----
kdf: argon2
salt: 9374F63E413933FF1F888E6EF9001728
type: secp256k1

qQTcf7tSYZ+8NYQVHTI1meYJwR5rit03lM6SIirS+8+B/RBVlPmjSV1NAJ5IBncp
H03hgFM=
=pgvk
-----END TENDERMINT PRIVATE KEY-----
`;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json",
};

async function serveDist() {
  const dist = join(root, "dist");
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = join(dist, path === "/" ? "index.html" : path);
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

const fail = (message) => {
  throw new Error(message);
};

async function main() {
  let server;
  let baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    ({ server, baseUrl } = await serveDist());
  }

  const keyDir = await mkdtemp(join(tmpdir(), "bitpoker-key-"));
  const keyFile = join(keyDir, "fixture.key");
  await writeFile(keyFile, FIXTURE_ARMOR);

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? "google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });

  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // 1. Risk gate: Continue must be disabled until the box is ticked.
    await page.waitForSelector('[data-testid="risk-continue"]');
    if (!(await page.$eval('[data-testid="risk-continue"]', (b) => b.disabled))) {
      fail("the risk gate let the player through without acknowledging");
    }
    await page.click('[data-testid="risk-ack"]');
    await page.click('[data-testid="risk-continue"]');

    // 2. Import the key file.
    await page.waitForSelector('[data-testid="key-file"]');
    const input = await page.$('[data-testid="key-file"]');
    await input.uploadFile(keyFile);
    // uploadFile sets the FileList over CDP but does not deliver a change
    // event React can see in this Chrome/puppeteer combination, so fire one.
    await page.$eval('[data-testid="key-file"]', (el) =>
      el.dispatchEvent(new Event("change", { bubbles: true }))
    );
    await page.type('[data-testid="key-passphrase"]', FIXTURE_PASSPHRASE);
    // The file is read asynchronously, so the button stays disabled for a tick
    // after uploadFile returns; clicking early is a no-op.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="key-import"]').disabled
    );
    await page.click('[data-testid="key-import"]');

    // 3. The banner proves the key decrypted to the expected account.
    try {
      await page.waitForSelector('[data-testid="testnet-banner"]', {
        timeout: 30000,
      });
    } catch (e) {
      // The import form reports why it refused; surfacing it beats a bare
      // selector timeout when this runs in CI.
      const reported = await page
        .$eval('[data-testid="key-error"]', (el) => el.textContent)
        .catch(() => "");
      fail(
        `key import did not complete: ${reported || e.message}` +
          (consoleErrors.length ? ` | page errors: ${consoleErrors.join(" | ")}` : "")
      );
    }
    const banner = await page.$eval(
      '[data-testid="testnet-banner"]',
      (el) => el.textContent
    );
    if (!banner.includes(FIXTURE_ADDRESS)) {
      fail(`banner does not show the imported account: ${banner}`);
    }
    if (!/Testnet key held in this browser tab/.test(banner)) {
      fail("the testnet warning is missing from the banner");
    }

    // 4. gamecore selfTest in the worker — the deployment check.
    await page.waitForSelector('[data-testid="selftest"]');
    await page.$eval("details", (d) => d.setAttribute("open", "open"));
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("selfTest")
      );
      button.click();
    });
    await page.waitForFunction(
      () => {
        const text =
          document.querySelector('[data-testid="selftest"]')?.textContent ?? "";
        return text !== "" && text !== "running…";
      },
      { timeout: 120000 }
    );
    const selfTest = await page.$eval(
      '[data-testid="selftest"]',
      (el) => el.textContent
    );
    if (!selfTest.startsWith("OK")) {
      fail(`gamecore selfTest failed in the worker: ${selfTest}`);
    }

    if (consoleErrors.length > 0) {
      fail(`uncaught page errors: ${consoleErrors.join(" | ")}`);
    }

    console.log("smoke OK");
    console.log(`  account:  ${FIXTURE_ADDRESS}`);
    console.log(`  selfTest: ${selfTest}`);
  } finally {
    await browser.close();
    server?.close();
  }
}

main().catch((e) => {
  console.error(`smoke FAILED: ${e.message}`);
  process.exit(1);
});
