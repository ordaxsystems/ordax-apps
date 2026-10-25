import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const scenarios = Object.freeze([
  ["standalone-preview", "orders"],
  ["embedded-preview", "kitchen"],
  ["embedded-preview", "orders"],
  ["embedded-preview", "tables"],
]);

function findChrome() {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Chromium/Chrome não está instalado no runner. A prova de navegador não pode ser ignorada.");
}

async function freeLocalPort() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return server.address().port;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function untilServing(url, server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`O servidor Food encerrou com código ${server.exitCode} antes da prova.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* The local HTTP server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error("O servidor localhost Food não inicializou para o teste de navegador.");
}

const browser = findChrome();
const port = await freeLocalPort();
const temporary = await mkdtemp(join(tmpdir(), "ordax-food-browser-"));
const server = spawn(process.execPath, ["prototypes/food-pizzeria/server.mjs", "-Port", String(port)], {
  env: { ...process.env, ORDAX_FOOD_BROWSER_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLogs = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (data) => { serverLogs = (serverLogs + data.toString()).slice(-4096); });
}

try {
  const base = `http://127.0.0.1:${port}/apps/food-pizzeria/`;
  await untilServing(base, server);
  for (const [presentation, view] of scenarios) {
    const url = new URL(base);
    url.searchParams.set("presentation", presentation);
    url.searchParams.set("view", view);
    url.searchParams.set("__browser_probe", "1");
    const profileDir = join(temporary, `${presentation}-${view}`);
    const result = spawnSync(browser, [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--disable-extensions", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--window-size=1440,900",
      "--virtual-time-budget=10000", "--dump-dom",
      `--user-data-dir=${profileDir}`, url.toString(),
    ], { encoding: "utf8", timeout: 45000, maxBuffer: 12 * 1024 * 1024 });
    const marker = result.stdout?.match(/FOOD_BROWSER_PROOF=(PASS|FAIL);([^<]*)/);
    if (result.error || result.status !== 0 || !marker || marker[1] !== "PASS") {
      throw new Error([
        `Prova real de navegador falhou: ${presentation}/${view}`,
        `exit=${result.status} signal=${result.signal} error=${result.error ?? "none"}`,
        `probe=${marker?.[0] ?? "ausente"}`,
        `Chrome stderr: ${(result.stderr ?? "").slice(-2400)}`,
        `HTML tail: ${(result.stdout ?? "").slice(-1200)}`,
      ].join("\n"));
    }
    process.stdout.write(`FOOD_BROWSER_PREVIEW=PASS ${presentation}/${view}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\nServer log: ${serverLogs}\n`);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await rm(temporary, { recursive: true, force: true });
}
