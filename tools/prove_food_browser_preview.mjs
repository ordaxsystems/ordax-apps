import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const scenarios = Object.freeze([
  { presentation: "standalone-preview", view: "orders" },
  { presentation: "embedded-preview", view: "kitchen" },
  { presentation: "embedded-preview", view: "kitchen", extra: { __configure_workflow: "single-pizzaiolo", __expected_preset_title: "1 pizzaiolo" }, resetPreviewStorage: true },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "1", stationStage: "prepare-order", screenCount: "1",
    __expected_station_title: "Preparar pedido", __viewport: "portrait", __exercise_solo: "1",
  }, viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "1", stationStage: "prepare-order", screenCount: "1", __viewport: "small-portrait",
  }, viewport: { width: 320, height: 568, deviceScaleFactor: 1, mobile: true } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "1", stationStage: "prepare-order", screenCount: "1", __viewport: "landscape",
  }, viewport: { width: 844, height: 390, deviceScaleFactor: 1, mobile: true } },
  { presentation: "embedded-preview", view: "kitchen", extra: { __configure_workflow: "pizzeria-line", __expected_preset_title: "Linha por etapas" }, resetPreviewStorage: true },
  ...[
    ["1", "open-dough", "Abrir massa"],
    ["2", "assembly", "Montagem"],
    ["3", "oven", "Forno"],
    ["4", "finish-pack", "Finalização e embalagem"],
  ].map(([station, stationStage, expectedTitle]) => ({
    presentation: "embedded-preview", view: "kitchen",
    extra: { station, stationStage, screenCount: "4", __expected_station_title: expectedTitle },
  })),
  { presentation: "embedded-preview", view: "kitchen", extra: { __configure_screen_count: "2" } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "1", stationStage: "open-dough", screenCount: "2",
    __expected_station_title: "Abrir massa", __expected_assigned_step_count: "2",
  } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "2", stationStage: "oven", screenCount: "2",
    __expected_station_title: "Forno + Finalização e embalagem", __expected_assigned_step_count: "2",
  } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "1", stationStage: "open-dough", screenCount: "4", __viewport: "notebook",
  }, viewport: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false } },
  { presentation: "embedded-preview", view: "kitchen", extra: {
    station: "2", stationStage: "assembly", screenCount: "4", __viewport: "landscape",
  }, viewport: { width: 844, height: 390, deviceScaleFactor: 1, mobile: true } },
  { presentation: "embedded-preview", view: "orders" },
  { presentation: "embedded-preview", view: "tables" },
]);

function chromeExecutable() {
  for (const binary of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [binary], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Chrome/Chromium não está instalado. A prova de navegador é obrigatória.");
}

async function freeLocalPort() {
  const temporaryServer = createServer();
  try {
    await new Promise((resolve, reject) => {
      temporaryServer.once("error", reject);
      temporaryServer.listen(0, "127.0.0.1", resolve);
    });
    return temporaryServer.address().port;
  } finally {
    await new Promise((resolve) => temporaryServer.close(resolve));
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([stopped, pause(4000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([stopped, pause(4000)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`O processo ${child.pid} não encerrou após SIGKILL.`);
  }
}

async function waitForHttp(url, child) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Processo encerrou prematuramente: ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return response;
    } catch { /* Local server still starting. */ }
    await pause(70);
  }
  throw new Error(`Serviço localhost não respondeu: ${url}`);
}

async function waitForChromeDebugger(profile, child) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome encerrou antes de publicar DevTools (exit=${child.exitCode}).`);
    }
    try {
      const data = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      const selectedPort = Number(data.split("\n")[0]);
      if (Number.isInteger(selectedPort) && selectedPort > 0) return selectedPort;
    } catch { /* Chrome creates this file after starting its debugger. */ }
    await pause(100);
  }
  throw new Error("Chrome não publicou DevToolsActivePort no perfil temporário.");
}

async function connectCdp(webSocketUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("O runner requer Node.js com WebSocket nativo (Node 22+).");
  }
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools não aceitou o socket.")), 8000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Erro de conexão com Chrome DevTools."));
    }, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timeout);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
    else operation.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP expirou ao executar ${method}.`));
      }, 8000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return { send, close: () => socket.close() };
}

async function waitForBrowserResult(cdp, label) {
  const deadline = Date.now() + 20000;
  let lastState;
  while (Date.now() < deadline) {
    try {
      const report = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const proof = document.getElementById("food-browser-proof");
          return {
            status: proof?.getAttribute("data-result") ?? "PENDING",
            text: proof?.textContent ?? "",
            path: location.href,
            readyState: document.readyState
          };
        })()`,
        returnByValue: true,
      });
      lastState = report?.result?.value;
      if (lastState?.status === "PASS") return lastState;
      if (lastState?.status === "FAIL") throw new Error(lastState.text);
    } catch (error) {
      if (String(error).includes("FOOD_BROWSER_PROOF=FAIL")) throw error;
      // Runtime execution contexts briefly disappear during Page.navigate.
    }
    await pause(125);
  }
  throw new Error(`Chrome não concluiu a prova ${label}: ${JSON.stringify(lastState)}`);
}

const browserBinary = chromeExecutable();
const serverPort = await freeLocalPort();
const temporary = await mkdtemp(join(tmpdir(), "ordax-food-browser-"));
const chromeProfile = join(temporary, "chrome-profile");
const localServer = spawn(process.execPath,
  ["prototypes/food-pizzeria/server.mjs", "-Port", String(serverPort)],
  { env: { ...process.env, ORDAX_FOOD_BROWSER_SMOKE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
const chrome = spawn(browserBinary, [
  "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--disable-extensions", "--no-first-run", "--no-default-browser-check",
  "--disable-background-networking", "--remote-allow-origins=*",
  "--remote-debugging-port=0",
  `--user-data-dir=${chromeProfile}`,
  "--window-size=1440,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let diagnostics = "";
for (const child of [localServer, chrome]) {
  child.on("error", (error) => { diagnostics = (diagnostics + String(error)).slice(-5000); });
  child.stderr?.on("data", (data) => {
    diagnostics = (diagnostics + data.toString()).slice(-5000);
  });
}
let cdp;
try {
  const base = `http://127.0.0.1:${serverPort}/apps/food-pizzeria/`;
  await waitForHttp(base, localServer);
  const debuggerPort = await waitForChromeDebugger(chromeProfile, chrome);
  const response = await waitForHttp(`http://127.0.0.1:${debuggerPort}/json`, chrome);
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) throw new Error("Chrome não publicou um target de página navegável.");
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const { presentation, view, extra: extraParameters = {}, viewport, resetPreviewStorage } of scenarios) {
    if (viewport) await cdp.send("Emulation.setDeviceMetricsOverride", viewport);
    else await cdp.send("Emulation.clearDeviceMetricsOverride");
    if (resetPreviewStorage) {
      await cdp.send("Runtime.evaluate", {
        expression: "localStorage.clear(); sessionStorage.clear()",
        returnByValue: true,
      });
    }
    const url = new URL(base);
    url.searchParams.set("presentation", presentation);
    url.searchParams.set("view", view);
    url.searchParams.set("__browser_probe", "1");
    for (const [key, value] of Object.entries(extraParameters)) url.searchParams.set(key, value);
    await cdp.send("Page.navigate", { url: url.toString() });
    await waitForBrowserResult(cdp, `${presentation}/${view}`);
    process.stdout.write(`FOOD_BROWSER_PREVIEW=PASS ${presentation}/${view}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\nChrome/server diagnostic tail: ${diagnostics}\n`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(localServer)]);
  await rm(temporary, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
}
