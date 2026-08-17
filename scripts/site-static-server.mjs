import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join } from "node:path"

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xml": "application/xml",
}

export async function startSiteStaticServer({ clientDir, port }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`)
    const hasExtension = extname(url.pathname) !== ""
    let filePath = join(clientDir, url.pathname)
    if (!extname(filePath)) filePath = join(filePath, "index.html")
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html")
    }
    if (!existsSync(filePath) && !hasExtension) {
      filePath = join(clientDir, "__spa-fallback.html")
    }
    if (!existsSync(filePath)) {
      response.writeHead(404)
      response.end("not found")
      return
    }
    response.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    })
    response.end(readFileSync(filePath))
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  }
}
