import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(hostRoot, "../../apps/food-pizzeria");
const [realHostRoot, realAppRoot] = await Promise.all([realpath(hostRoot), realpath(appRoot)]);
const host = "127.0.0.1";
const portFlag = process.argv.findIndex((value) => value.toLowerCase() === "-port");
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 4240;

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new TypeError("Porta inválida. Use um número entre 1024 e 65535.");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function response(res, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders, ...extraHeaders, "Content-Type": contentType });
  res.end(body);
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    response(res, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);
  } catch {
    response(res, 400, "Invalid URL");
    return;
  }

  if (pathname === "/") {
    res.writeHead(302, { ...securityHeaders, Location: "/apps/food-pizzeria/" });
    res.end();
    return;
  }
  if (pathname === "/apps/food-pizzeria") {
    res.writeHead(308, { ...securityHeaders, Location: "/apps/food-pizzeria/" });
    res.end();
    return;
  }

  let root;
  let realRoot;
  let relativePath;
  if (pathname === "/preview.mjs") {
    root = hostRoot;
    realRoot = realHostRoot;
    relativePath = "preview.mjs";
  } else if (pathname.startsWith("/apps/food-pizzeria/")) {
    root = appRoot;
    realRoot = realAppRoot;
    relativePath = pathname.slice("/apps/food-pizzeria/".length) || "index.html";
  } else {
    response(res, 404, "Not found");
    return;
  }

  if (relativePath.includes("\\") || relativePath.split("/").some((part) => part === ".." || part === "." || part === "")) {
    response(res, 404, "Not found");
    return;
  }
  const filePath = path.resolve(root, relativePath);
  if (!isWithinRoot(root, filePath)) {
    response(res, 404, "Not found");
    return;
  }

  try {
    const realFilePath = await realpath(filePath);
    if (!isWithinRoot(realRoot, realFilePath)) {
      response(res, 404, "Not found");
      return;
    }
    const contentType = contentTypes.get(path.extname(filePath).toLowerCase());
    if (!contentType) {
      response(res, 404, "Not found");
      return;
    }
    let content = await readFile(realFilePath);
    if (pathname === "/apps/food-pizzeria/" && req.method !== "HEAD") {
      const html = content.toString("utf8");
      if (!html.includes("</body>")) {
        response(res, 500, "Food app shell is missing its closing body tag");
        return;
      }
      content = Buffer.from(html.replace("</body>", '    <script type="module" src="/preview.mjs"></script>\n  </body>'), "utf8");
    }
    res.writeHead(200, { ...securityHeaders, "Content-Type": contentType });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      response(res, 404, "Not found");
      return;
    }
    response(res, 500, "Local development host could not read an app asset");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`OrdaX Food — browser preview: http://${host}:${port}\n`);
});