import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { featureIds } from "./shared/feature-registry.mjs";
import { getGroqStatus, handleGroqRequest } from "./shared/groq-development-api.mjs";
import { getOrcaSlicerStatus, sliceWithOrcaToResponse } from "./shared/orca-slicer-development.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const apps = new Map([["ordax-3d", 4235]]);
const features = new Set(featureIds);
const appSourceModules = new Map([
  ["ordax-3d", new Set([
    "domain/print-draft.mjs",
    "application/print-draft-service.mjs",
    "ports/print-draft-repository.mjs",
    "adapters/app-data-print-draft-repository.mjs",
    "domain/technical-print-job.mjs",
    "domain/technical-print-job-fixtures.mjs",
    "application/technical-jobs-service.mjs",
    "ports/technical-job-repository.mjs",
    "adapters/app-data-technical-job-repository.mjs",
  ])],
]);
const contentTypes = {
  "index.html": "text/html; charset=utf-8",
  "app.mjs": "text/javascript; charset=utf-8",
  "app.css": "text/css; charset=utf-8",
  "feature.mjs": "text/javascript; charset=utf-8",
  "bed-envelope.mjs": "text/javascript; charset=utf-8",
  "mesh-import.mjs": "text/javascript; charset=utf-8",
  "source-fingerprint.mjs": "text/javascript; charset=utf-8",
  "demo-model.mjs": "text/javascript; charset=utf-8",
  "mesh-viewer.mjs": "text/javascript; charset=utf-8",
  "slicer-port.mjs": "text/javascript; charset=utf-8",
  "profile-compatibility.mjs": "text/javascript; charset=utf-8",
  "ai-copilot.mjs": "text/javascript; charset=utf-8",
  "mesh-analysis.mjs": "text/javascript; charset=utf-8",
  "gcode-preview.mjs": "text/javascript; charset=utf-8",
  "viewport-geometry.mjs": "text/javascript; charset=utf-8",
  "orca-geometry.mjs": "text/javascript; charset=utf-8",
  "project-bundle.mjs": "text/javascript; charset=utf-8",
  "zip-container.mjs": "text/javascript; charset=utf-8",
  "shared.mjs": "text/javascript; charset=utf-8",
  "shared.css": "text/css; charset=utf-8",
  "product-host.mjs": "text/javascript; charset=utf-8",
  "product-host.css": "text/css; charset=utf-8",
  "development-entry.mjs": "text/javascript; charset=utf-8",
  "development-services.mjs": "text/javascript; charset=utf-8",
  "feature-registry.mjs": "text/javascript; charset=utf-8",
  "feature-surface.css": "text/css; charset=utf-8",
  "infill-patterns.mjs": "text/javascript; charset=utf-8",
  "seam-positions.mjs": "text/javascript; charset=utf-8",
  "nozzle-temperatures.mjs": "text/javascript; charset=utf-8",
  "bed-types.mjs": "text/javascript; charset=utf-8",
};

const appId = process.argv[2] ?? process.env.ORDAX_3D_APP;
if (!apps.has(appId)) throw new TypeError("Pass the OrdaX 3D product ID: ordax-3d");
const port = Number(process.env.PORT ?? apps.get(appId));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("PORT must be between 1024 and 65535");

const appRoot = resolve(root, "apps", appId);
const sharedRoot = resolve(root, "shared");

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

function isLoopback(address = "") {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isLocalRequest(request, requireOrigin) {
  if (!isLoopback(request.socket.remoteAddress)) return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { return false; }
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(hostUrl.hostname) || Number(hostUrl.port || 80) !== port) return false;
  const origin = request.headers.origin;
  if (requireOrigin && typeof origin !== "string") return false;
  if (typeof origin === "string") {
    try {
      const originUrl = new URL(origin);
      if (originUrl.protocol !== "http:" || originUrl.host !== hostUrl.host) return false;
    } catch { return false; }
  }
  const fetchSite = request.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function readJsonBody(request, maxBytes = 256 * 1024) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw Object.assign(new Error("O pedido excede o limite permitido."), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("O pedido excede o limite permitido."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("O corpo precisa ser JSON válido."), { statusCode: 400 }); }
}

async function readLimitedBody(request, maxBytes) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw Object.assign(new Error("O pedido excede o limite permitido."), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("O pedido excede o limite permitido."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function handleApi(request, response, pathname) {
  if (appId !== "ordax-3d") {
    sendJson(response, 404, { error: "API indisponível para este app de desenvolvimento." });
    return;
  }
  if (!isLocalRequest(request, request.method === "POST")) {
    sendJson(response, 403, { error: "Origem local não autorizada." });
    return;
  }
  if (pathname === "/api/slicer/status" && request.method === "GET") {
    sendJson(response, 200, await getOrcaSlicerStatus());
    return;
  }
  if (pathname === "/api/slicer/slice" && request.method === "POST") {
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !/^multipart\/form-data\s*;/i.test(contentType)) {
      sendJson(response, 415, { error: "O fatiamento espera um pedido multipart do host local." });
      return;
    }
    let bytes;
    try { bytes = await readLimitedBody(request, 17 * 1024 * 1024); }
    catch (error) {
      sendJson(response, error.statusCode ?? 400, { error: error.message || "Não foi possível ler a malha do trabalho." });
      return;
    }
    let formData;
    try {
      const formRequest = new Request("http://127.0.0.1/api/slicer/slice", { method: "POST", headers: { "content-type": contentType }, body: bytes });
      formData = await formRequest.formData();
    } catch {
      sendJson(response, 400, { error: "O formulário do fatiamento está incompleto ou inválido." });
      return;
    }
    const controller = new AbortController();
    const abortIfDisconnected = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", abortIfDisconnected);
    response.once("close", abortIfDisconnected);
    try { await sliceWithOrcaToResponse(formData, response, { signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (!response.headersSent) sendJson(response, error.statusCode ?? 502, { error: error.message || "OrcaSlicer não conseguiu concluir o trabalho." });
      else response.destroy();
    } finally {
      request.off("aborted", abortIfDisconnected);
      response.off("close", abortIfDisconnected);
    }
    return;
  }
  if (pathname === "/api/intelligence/status" && request.method === "GET") {
    const snapshot = getGroqStatus();
    const setupHint = snapshot.state === "error"
      ? "GROQ_MODEL contém um identificador inválido; corrija a variável e reinicie o host."
      : snapshot.state === "degraded" ? "Defina GROQ_API_KEY no servidor local e reinicie o host para habilitar consultas Groq." : "";
    sendJson(response, 200, { snapshot, setupHint });
    return;
  }
  if (pathname === "/api/intelligence" && request.method === "POST") {
    if (!process.env.GROQ_API_KEY) {
      sendJson(response, 503, { error: "Groq não está configurado. Defina GROQ_API_KEY no servidor local e reinicie o host." });
      return;
    }
    let body;
    try { body = await readJsonBody(request); }
    catch (error) {
      const status = error.statusCode ?? 400;
      sendJson(response, status, { error: error.statusCode ? error.message : "Não foi possível ler o pedido JSON." });
      return;
    }
    const controller = new AbortController();
    const abortIfDisconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", abortIfDisconnected);
    try {
      const result = await handleGroqRequest(body, { signal: controller.signal });
      if (!response.destroyed) sendJson(response, 200, result);
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      sendJson(response, error.statusCode ?? 502, { error: error.publicMessage ?? "Não foi possível consultar Groq. Confira a conexão e a configuração do modelo." });
    } finally { response.off("close", abortIfDisconnected); }
    return;
  }
  sendJson(response, 405, { error: "Método ou rota de Intelligence/Fatiamento não permitidos." });
}

function resolveRequest(pathname) {
  if (pathname === "/" || pathname === "/index.html") return [resolve(appRoot, "index.html"), contentTypes["index.html"]];
  if (pathname === "/app.css") return [resolve(appRoot, "app.css"), contentTypes["app.css"]];
  if (pathname === "/src/ui/app.mjs" || pathname === "/src/ui/views.mjs") return [resolve(appRoot, pathname.slice(1)), contentTypes["app.mjs"]];
  const appSource = pathname.match(/^\/apps\/([a-z0-9-]+)\/src\/([a-z]+\/[a-z0-9-]+\.mjs)$/);
  if (appSource && appSource[1] === appId && appSourceModules.get(appId)?.has(appSource[2])) {
    return [resolve(root, "apps", appSource[1], "src", appSource[2]), contentTypes["app.mjs"]];
  }
  if (["/shared.mjs", "/shared.css", "/product-host.mjs", "/product-host.css", "/development-entry.mjs", "/development-services.mjs", "/feature-registry.mjs", "/feature-surface.css"].includes(pathname)) {
    const name = pathname.slice(1);
    return [resolve(sharedRoot, name), contentTypes[name]];
  }
  if (["/shared/infill-patterns.mjs", "/shared/seam-positions.mjs", "/shared/nozzle-temperatures.mjs", "/shared/bed-types.mjs"].includes(pathname)) {
    const name = pathname.slice("/shared/".length);
    return [resolve(sharedRoot, name), contentTypes[name]];
  }
  const feature = pathname.match(/^\/features\/([a-z0-9-]+)\/(feature\.mjs|bed-envelope\.mjs|app\.css|ai-copilot\.mjs|mesh-analysis\.mjs|demo-model\.mjs|mesh-import\.mjs|mesh-viewer\.mjs|slicer-port\.mjs|profile-compatibility\.mjs|gcode-preview\.mjs|viewport-geometry\.mjs|orca-geometry\.mjs|project-bundle\.mjs|source-fingerprint\.mjs|zip-container\.mjs)$/);
  if (feature && features.has(feature[1])) {
    const [ , featureId, fileName ] = feature;
    return [resolve(root, "features", featureId, fileName), contentTypes[fileName]];
  }
  return null;
}

const server = createServer(async (request, response) => {
  let pathname;
  try { pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; }
  catch { response.writeHead(400, { "Cache-Control": "no-store" }); response.end(); return; }
  if (pathname.startsWith("/api/")) {
    await handleApi(request, response, pathname);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const file = resolveRequest(pathname);
  if (!file) {
    response.writeHead(404, { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    response.end("Not found");
    return;
  }
  try {
    const metadata = await stat(file[0]);
    if (!metadata.isFile()) throw new Error("Not a file");
    const body = await readFile(file[0]);
    response.writeHead(200, {
      "Content-Type": file[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    response.end("App resource unavailable");
  }
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`${appId} development host: http://127.0.0.1:${port}/\n`));
server.on("error", error => { process.stderr.write(`3D development host failed: ${error.message}\n`); process.exitCode = 1; });
