// Local preview: `npm install && ANTHROPIC_API_KEY=... npm run dev`, then open http://localhost:3000
// Photo uploads also need BLOB_READ_WRITE_TOKEN and ADMIN_PASSWORD.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const root = process.cwd();

http.createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  const api = /^\/api\/(chat|photos)(\?|$)/.exec(req.url);
  if (api) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
    const { default: handler } = await import(`./api/${api[1]}.js`);
    return handler(req, res);
  }
  const path = normalize(join(root, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0])));
  if (!path.startsWith(root) || path.includes("node_modules") || path.includes("/api/")) return res.status(404).end();
  try {
    res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.status(404).end("Not found"); }
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
