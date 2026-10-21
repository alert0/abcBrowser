import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'

const [htmlPath, evidencePath] = process.argv.slice(2)
if (!htmlPath || !evidencePath) {
  console.error('usage: node probe-server.mjs <probe-html> <headers-evidence.json>')
  process.exit(2)
}

const html = await readFile(htmlPath)
const captures = {}
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/probe.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html)
    return
  }
  if (request.method === 'GET' && url.pathname === '/headers') {
    const caseId = (url.searchParams.get('case') ?? 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || 'default'
    const headers = {
      acceptLanguage: request.headers['accept-language'] ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      secChUa: request.headers['sec-ch-ua'] ?? null,
      secChUaPlatform: request.headers['sec-ch-ua-platform'] ?? null,
      secChUaFullVersionList: request.headers['sec-ch-ua-full-version-list'] ?? null
    }
    captures[caseId] = { capturedAtUtc: new Date().toISOString(), headers }
    await writeFile(evidencePath, `${JSON.stringify(captures, null, 2)}\n`, 'utf8')
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(headers))
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('not found')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  console.log(`APOSTATE_PROBE_SERVER:${JSON.stringify({ host: '127.0.0.1', port: address.port })}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
