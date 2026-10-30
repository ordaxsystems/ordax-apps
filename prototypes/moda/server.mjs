import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(hostRoot, "../../apps/moda");
const [realHostRoot, realAppRoot] = await Promise.all([realpath(hostRoot), realpath(appRoot)]);
const hostname = "127.0.0.1";
const portFlag = process.argv.findIndex((value) => value.toLowerCase() === "-port");
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 4245;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new TypeError("Porta inválida. Use um número entre 1024 e 65535.");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function respond(response, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  response.writeHead(status, { ...securityHeaders, ...extraHeaders, "Content-Type": contentType });
  response.end(body);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    respond(response, 405, "Method not allowed");
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://" + hostname + ":" + port).pathname); }
  catch { respond(response, 400, "Invalid URL"); return; }

  if (pathname === "/") {
    response.writeHead(302, { ...securityHeaders, Location: "/apps/moda/" });
    response.end();
    return;
  }
  if (pathname === "/apps/moda") {
    response.writeHead(308, { ...securityHeaders, Location: "/apps/moda/" });
    response.end();
    return;
  }

  let root;
  let realRoot;
  let relativePath;
  if (pathname === "/preview-data-port.mjs") {
    root = hostRoot;
    realRoot = realHostRoot;
    relativePath = "preview-data-port.mjs";
  } else if (pathname === "/preview.mjs") {
    root = hostRoot;
    realRoot = realHostRoot;
    relativePath = "preview.mjs";
  } else if (pathname.startsWith("/apps/moda/")) {
    root = appRoot;
    realRoot = realAppRoot;
    relativePath = pathname.slice("/apps/moda/".length) || "index.html";
  } else {
    respond(response, 404, "Not found");
    return;
  }

  if (relativePath.includes("\\") || relativePath.split("/").some((part) => part === ".." || part === "." || part === "")) {
    respond(response, 404, "Not found");
    return;
  }
  const filePath = path.resolve(root, relativePath);
  if (!inside(root, filePath)) { respond(response, 404, "Not found"); return; }

  try {
    const realFilePath = await realpath(filePath);
    if (!inside(realRoot, realFilePath)) { respond(response, 404, "Not found"); return; }
    const contentType = contentTypes.get(path.extname(filePath).toLowerCase());
    if (!contentType) { respond(response, 404, "Not found"); return; }
    let content = await readFile(realFilePath);
    if (pathname === "/apps/moda/" && request.method !== "HEAD") {
      const html = content.toString("utf8");
      if (!html.includes("</body>")) { respond(response, 500, "Moda app shell is invalid"); return; }
      content = Buffer.from(html.replace("</body>", '    <script type="module" src="/preview.mjs"></script>\n  </body>'), "utf8");
    }
    response.writeHead(200, { ...securityHeaders, "Content-Type": contentType });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") { respond(response, 404, "Not found"); return; }
    respond(response, 500, "Local Moda host could not read an app asset");
  }
});

server.listen(port, hostname, () => {
  process.stdout.write("OrdaX Moda · Ateliê Aurora: http://" + hostname + ":" + port + "\n");
});
