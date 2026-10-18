const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer((req, res) => {
    let file;
    try {
      file = path.resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (file === root) file = path.join(root, "index.html");
    fs.readFile(file, (err, data) => {
      res.writeHead(err ? 404 : 200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      res.end(err ? "Not found" : data);
    });
  })
  .listen(4173, "0.0.0.0", () =>
    console.log("Espresso Lab: http://localhost:4173"),
  );
