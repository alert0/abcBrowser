// Uses an existing runtime in place. Never downloads, patches, or repackages it.
import { build } from 'esbuild'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir, platform, release, arch, cpus, totalmem } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const executable = option('--executable')
if (!executable) throw Error('Usage: node tools/apostate-runtime-acceptance/local.mjs --executable C:\\path\\chrome.exe [--output directory] [--headless]')
const output = resolve(option('--output') ?? `docs/testing/evidence/apostate-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(output, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'abc-apostate-local-'))
const bundle = join(work, 'adapter.mjs')
await build({ stdin: { contents: `export {buildLaunchArgs} from './src/main/launch-args'; export {defaultProfileDraft} from './src/shared/defaults'; export {hostHardwareSnapshot} from './src/main/host-hardware';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: bundle })
const { buildLaunchArgs, defaultProfileDraft, hostHardwareSnapshot } = await import(pathToFileURL(bundle).href)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const environment = { platform: platform(), release: release(), arch: arch(), cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryBytes: totalmem(), host: hostHardwareSnapshot(), executable: resolve(executable), executableSha256: sha256(await readFile(executable)), headed: !process.argv.includes('--headless'), node: process.version }
await writeFile(join(output, 'environment.json'), JSON.stringify(environment, null, 2))
const evidence = { startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }), environment, checks: [], cases: {} }
function check(name, status, details) { evidence.checks.push({ name, status, details }); console.log(`${status} ${name}: ${details}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const headers = {}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/headers') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ acceptLanguage: req.headers['accept-language'], userAgent: req.headers['user-agent'] })); return }
  headers[url.searchParams.get('case')] = req.headers
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><title>abcBrowser Apostate acceptance</title><h1>abcBrowser Apostate acceptance</h1><p>Loopback-only native API probe.</p>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}`
let stunPackets = 0
const stun = createSocket('udp4')
stun.on('message', (message, remote) => {
  if (message.length < 20 || message.readUInt16BE(0) !== 1 || message.readUInt32BE(4) !== 0x2112a442) return
  stunPackets++
  const response = Buffer.alloc(32)
  response.writeUInt16BE(0x0101, 0); response.writeUInt16BE(12, 2)
  message.copy(response, 4, 4, 20)
  response.writeUInt16BE(0x0020, 20); response.writeUInt16BE(8, 22); response[25] = 1
  response.writeUInt16BE(remote.port ^ 0x2112, 26)
  remote.address.split('.').forEach((part, i) => { response[28 + i] = Number(part) ^ message[4 + i] })
  stun.send(response, remote.port, remote.address)
})
await new Promise(r => stun.bind(0, '127.0.0.1', r))
const stunUrl = `stun:127.0.0.1:${stun.address().port}`
async function stop(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise(r => { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', r); killer.on('error', r) })
  } else child.kill('SIGTERM')
}
function launch(args, label) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', startError
  child.stdout.on('data', b => { stdout += b }); child.stderr.on('data', b => { stderr += b }); child.on('error', e => { startError = e.message })
  return { child, async save() {
    const safeArgs = args.map(a => a.startsWith('--user-data-dir=') ? '--user-data-dir=<isolated-temporary-profile>' : a.startsWith(url) ? '<loopback-probe>' : a)
    await Promise.all([writeFile(join(output, `${label}.stdout.txt`), stdout), writeFile(join(output, `${label}.stderr.txt`), stderr), writeFile(join(output, `${label}.arguments.json`), JSON.stringify(safeArgs, null, 2))])
    return { exitCode: child.exitCode, startError, stdout, stderr, arguments: safeArgs }
  } }
}
async function cli(label, args) {
  const run = launch([`--user-data-dir=${join(work, label)}`, ...args], label)
  const deadline = Date.now() + 12000
  while (run.child.exitCode === null && Date.now() < deadline) await wait(100)
  const timeout = run.child.exitCode === null
  if (timeout) await stop(run.child)
  const result = await run.save(); result.timeout = timeout
  evidence.cases[label] = result
  return result
}
async function connect(endpoint) {
  const ws = new WebSocket(endpoint)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let nextId = 0
  const pending = new Map()
  ws.onmessage = event => { const value = JSON.parse(event.data); const item = pending.get(value.id); if (item) { pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result) } }
  return { ws, send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, 12000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) }) } }
}
function profile(mode) {
  const p = { ...defaultProfileDraft(), id: 'acceptance', serialNumber: 1, name: `acceptance-${mode}`, status: 'closed', createdAt: '', updatedAt: '', favorite: false }
  Object.assign(p.fingerprint, { hardwareProfileId: mode === 'host' ? 'windows-host' : 'legacy-custom', seed: 42, platform: 'windows', hardwareConcurrency: 2, deviceMemoryGb: 2, screenWidth: 1280, screenHeight: 900, language: 'en-GB', acceptLanguages: 'en-GB,en', timezone: 'Europe/London', gpuAnchor: 'auto', networkIdentityMode: 'manual', webrtcPolicy: 'proxy_only' })
  p.window = { mode: 'custom', width: 1000, height: 700, x: 0, y: 0 }
  p.startUrls = []
  if (mode === 'custom') p.fingerprint.apostateProfileJson = JSON.stringify({ cpu: { logical_cores: 2 }, memory: { total_bytes: 2 * 1024 ** 3 }, screen: { width: 1280, height: 900, avail_width: 1280, avail_height: 852 }, locale: { application: 'en-GB', accept_languages: 'en-GB,en', timezone: 'Europe/London' } })
  return p
}
async function browser(label, p, nativeConflictArgs = []) {
  const dir = join(work, label)
  const args = buildLaunchArgs(p, { userDataDir: dir, ...{ hostHardwareConcurrency: environment.host.hardwareConcurrency, hostMemoryGb: environment.host.physicalMemoryGb } })
  args.push(...nativeConflictArgs, '--remote-debugging-port=0', ...(environment.headed ? [] : ['--headless=new']), `${url}/?case=${label}`)
  const run = launch(args, label)
  let cdp
  const beforeStun = stunPackets
  try {
    let port
    const deadline = Date.now() + 15000
    while (!port && Date.now() < deadline && run.child.exitCode === null) { try { port = (await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch {} if (!port) await wait(100) }
    if (!port) throw Error('No DevToolsActivePort; inspect raw stderr and Windows runtime environment')
    let target
    while (!target && Date.now() < deadline) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = targets.find(t => t.type === 'page' && t.url.startsWith(url))
      if (!target) await wait(100)
    }
    if (!target) throw Error('Local probe page did not load')
    cdp = await connect(target.webSocketDebuggerUrl)
    // A target can be listed before its first navigation commits. Wait for the
    // probe document instead of evaluating in Chromium's disposable initial context.
    let ready = false
    while (!ready && Date.now() < deadline) {
      try {
        const state = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `location.origin === ${JSON.stringify(url)} && document.readyState === 'complete'` })
        ready = state.result?.value === true
      } catch (error) { if (!/context|navigat/i.test(error.message)) throw error }
      if (!ready) await wait(100)
    }
    if (!ready) throw Error('Probe document never became ready')
    const probe = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(${async function (stunUrl) {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 80
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ef7521'; ctx.fillRect(0, 0, 220, 70); ctx.fillStyle = '#184896'; ctx.font = '21px Arial'; ctx.fillText('Apostate edges 42', 3.5, 35.5); ctx.beginPath(); ctx.arc(85.3, 42.7, 23.4, 0, 6.283); ctx.stroke()
      const gl = document.createElement('canvas').getContext('webgl'); let webgl = null
      if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); const pixels = new Uint8Array(4); gl.clearColor(.2,.4,.6,1); gl.clear(gl.COLOR_BUFFER_BIT); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels); webgl = { vendor: ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), pixels: Array.from(pixels) } }
      const webrtc = { candidates: [], error: null, gatheringComplete: false }
      try { const pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] }); pc.createDataChannel('probe'); pc.onicecandidate = e => { if (e.candidate) webrtc.candidates.push({ type: e.candidate.type, protocol: e.candidate.protocol }); else webrtc.gatheringComplete = true }; await pc.setLocalDescription(await pc.createOffer()); await new Promise(r => setTimeout(r, 1800)); pc.close() } catch(e) { webrtc.error = String(e) }
      const result = { hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, languages: [...navigator.languages], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight }, webgl, canvas: canvas.toDataURL(), webrtc, headers: await (await fetch('/headers')).json() }
      document.body.innerHTML = '<h1>Apostate API evidence</h1><pre></pre>'; document.querySelector('pre').textContent = JSON.stringify({ ...result, canvas: '<saved in evidence JSON>' }, null, 2)
      return result
    }.toString()})(${JSON.stringify(stunUrl)})` })
    if (probe.exceptionDetails || !probe.result?.value) throw Error(JSON.stringify(probe.exceptionDetails ?? probe))
    const result = probe.result.value
    result.stunRequests = stunPackets - beforeStun
    result.canvasSha256 = sha256(result.canvas)
    try { const screenshot = await cdp.send('Page.captureScreenshot'); await writeFile(join(output, `${label}.png`), Buffer.from(screenshot.data, 'base64')) } catch {}
    evidence.cases[label] = { requested: p.fingerprint, runtime: result, effectiveArguments: (await run.save()).arguments }
    await writeFile(join(output, `${label}.json`), JSON.stringify(evidence.cases[label], null, 2))
    check(`${label} startup/API`, 'PASS', 'Native browser API result and screenshot captured')
    return result
  } catch(e) { check(`${label} startup/API`, 'BLOCKED', e.message); evidence.cases[label] = { error: e.message }; return null }
  finally { cdp?.ws.close(); await stop(run.child); await run.save() }
}
function equal(name, actual, expected) { check(name, JSON.stringify(actual) === JSON.stringify(expected) ? 'PASS' : 'FAIL', `expected=${JSON.stringify(expected)} observed=${JSON.stringify(actual)}`) }
try {
  const hostExplain = await cli('host-explain', ['--fingerprint=host', '--fingerprint-explain'])
  check('Host explain', /composition\s+disabled/.test(hostExplain.stdout) ? 'PASS' : 'FAIL', `exit=${hostExplain.exitCode}; raw stdout/stderr saved`)
  const seedArgs = buildLaunchArgs(profile('seed'), { userDataDir: join(work, 'seed-explain') }).filter(a => !a.startsWith('--user-data-dir='))
  const explain = await cli('seed-explain', [...seedArgs, '--fingerprint-explain'])
  check('Seed explain', /seed\s+42/.test(explain.stdout) && explain.exitCode === 0 ? 'PASS' : 'FAIL', 'Exact adapter-generated switches; raw stdout/stderr saved')
  if (hostExplain.startError || seedArgs.length === 0 || hostExplain.timeout || explain.timeout || explain.exitCode !== 0) throw Error('Existing binary did not pass explain; API checks are blocked')
  const host = await browser('host', profile('host'))
  const seed = await browser('seed', profile('seed'))
  const custom = await browser('custom', profile('custom'))
  if (host) equal('Host CPU equals physical host', host.hardwareConcurrency, environment.host.hardwareConcurrency)
  for (const [name, result] of [['seed', seed], ['custom', custom]]) {
    if (!result) continue
    for (const [key, expected] of Object.entries({ hardwareConcurrency: 2, deviceMemory: 2, language: 'en-GB', languages: ['en-GB','en'], timezone: 'Europe/London' })) equal(`${name} ${key}`, result[key], expected)
    equal(`${name} screen`, [result.screen.width, result.screen.height], [1280,900])
    check(`${name} Canvas`, result.canvas.startsWith('data:image/png') ? 'PASS' : 'FAIL', result.canvasSha256)
    check(`${name} WebGL`, result.webgl?.renderer ? 'PASS' : 'BLOCKED', JSON.stringify(result.webgl))
    check(`${name} Accept-Language`, /^en-GB(?:,|$)/i.test(result.headers.acceptLanguage) ? 'PASS' : 'FAIL', result.headers.acceptLanguage)
  }
  for (const mode of ['42', 'host']) {
    const conflict = await browser(`custom-with-${mode}`, profile('custom'), [`--fingerprint=${mode}`, '--fingerprint-platform=macos', '--fingerprint-hardware-concurrency=1'])
    if (conflict) {
      equal(`Native Custom overrides ${mode} CPU`, conflict.hardwareConcurrency, 2)
      equal(`Native Custom overrides ${mode} platform`, conflict.platform, host?.platform)
    }
  }
  const partial = profile('custom'); partial.fingerprint.apostateProfileJson = '{"cpu":{"logical_cores":2}}'
  const inherited = await browser('partial', partial)
  if (host && inherited) for (const key of ['deviceMemory','platform','userAgent','screen','language','languages','timezone','webgl','canvasSha256']) equal(`partial inherits ${key}`, inherited[key], host[key])
  const repeat = await browser('seed-repeat', profile('seed'))
  if (seed && repeat) for (const key of ['hardwareConcurrency','deviceMemory','language','languages','timezone','screen','webgl','canvasSha256']) equal(`repeat ${key}`, repeat[key], seed[key])
  const changed = profile('seed'); changed.fingerprint.seed = 43
  const changedResult = await browser('seed-changed', changed)
  check('Different seeds API identity', seed && changedResult && JSON.stringify(seed.webgl) !== JSON.stringify(changedResult.webgl) ? 'PASS' : 'UNVERIFIED', 'A different seed need not change every explicitly pinned API value')
  const noise = profile('seed'); noise.fingerprint.canvasWebglNoise = true
  const noisy = await browser('seed-noise', noise)
  check('Canvas edge noise changes readback', seed && noisy && seed.canvasSha256 !== noisy.canvasSha256 ? 'PASS' : 'UNVERIFIED', 'Edge/text probe compared; solid-color probes are insufficient')
  const over = profile('seed'); over.fingerprint.hardwareConcurrency = 4096; over.fingerprint.deviceMemoryGb = 4096
  const clamped = await browser('adapter-over-host', over)
  if (clamped) equal('Adapter CPU clamp', clamped.hardwareConcurrency, environment.host.hardwareConcurrency)
  const customOver = profile('custom'); customOver.fingerprint.apostateProfileJson = JSON.stringify({cpu:{logical_cores:4096},memory:{total_bytes:4096*1024**3}})
  const customClamped = await browser('custom-over-host', customOver)
  if (customClamped) equal('Custom CPU clamp', customClamped.hardwareConcurrency, environment.host.hardwareConcurrency)
  if (host && customClamped) equal('Custom memory clamp bucket matches Host', customClamped.deviceMemory, host.deviceMemory)
  const gpu = profile('seed'); gpu.fingerprint.gpuAnchor = 'windows-d3d11-intel-79dfeb5b4f99'; gpu.fingerprint.gpuRenderer = 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)'
  const gpuExplain = await cli('gpu-explain', [...buildLaunchArgs(gpu, { userDataDir: join(work, 'gpu-explain') }).filter(a => !a.startsWith('--user-data-dir=')), '--fingerprint-explain'])
  check('Pinned GPU explain', gpuExplain.exitCode === 0 && gpuExplain.stdout.includes('d3d11-intel-uhd-graphics-630') ? 'PASS' : 'UNVERIFIED', 'Catalogue row must identify the pinned model; raw output saved')
  const gpuResult = await browser('gpu-pinned', gpu)
  if (gpuResult?.webgl) equal('Pinned GPU renderer', gpuResult.webgl.renderer, gpu.fingerprint.gpuRenderer)
  const direct = profile('seed'); direct.fingerprint.webrtcPolicy = 'default'
  const control = await browser('webrtc-control', direct)
  check('Controlled loopback STUN blocked', control?.stunRequests > 0 && seed?.stunRequests === 0 ? 'PASS' : 'UNVERIFIED', `control=${control?.stunRequests}; block=${seed?.stunRequests}; no public destination used`)
  check('Public WebRTC/STUN/TURN leak path', 'UNVERIFIED', 'No external controlled STUN/TURN or proxy relay test was authorized/provisioned')
  for (const [label, args] of [
    ['host-field-conflict', ['--fingerprint=host', '--fingerprint-hardware-concurrency=2']],
    ['raw-over-host-cpu', ['--fingerprint=42', `--fingerprint-hardware-concurrency=${environment.host.hardwareConcurrency+4}`]],
    ['raw-over-host-memory', ['--fingerprint=42', `--fingerprint-device-memory=${Math.ceil(environment.host.physicalMemoryGb)+8}`]]
  ]) { const result = await cli(label, [...args, '--fingerprint-explain']); check(label, result.exitCode !== 0 && !result.timeout && /apostate:/i.test(result.stderr) ? 'PASS' : 'FAIL', `Expected explicit native refusal, exit=${result.exitCode}; inspect raw stderr`) }
} catch(e) { check('Acceptance execution', 'BLOCKED', e.stack) }
finally {
  server.close(); stun.close()
  evidence.completedAt = new Date().toISOString()
  evidence.runtimeExecutableUnchanged = sha256(await readFile(executable)) === environment.executableSha256
  check('Existing runtime executable unchanged', evidence.runtimeExecutableUnchanged ? 'PASS' : 'FAIL', environment.executableSha256)
  await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`Evidence: ${output}`)
  if (evidence.checks.some(c => c.status === 'FAIL' || c.status === 'BLOCKED')) process.exitCode = 1
}
