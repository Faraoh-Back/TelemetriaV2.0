import crypto from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.MOCK_TELEMETRY_PORT ?? 8081)
const TICK_MS = Number(process.env.MOCK_TELEMETRY_TICK_MS ?? 50)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const clients = new Set()
const startedAt = Date.now()

function nowSeconds() {
  return Date.now() / 1000
}

function wave(t, min, max, speed = 1, phase = 0) {
  const normalized = (Math.sin(t * speed + phase) + 1) / 2
  return min + normalized * (max - min)
}

function setUnsigned(rawData, startBit, length, value) {
  let raw = Math.max(0, Math.round(value))
  const max = 2 ** length - 1
  raw = Math.min(raw, max)

  for (let i = 0; i < length; i += 1) {
    const bit = (raw >> i) & 1
    const globalBit = startBit + i
    const byteIndex = Math.floor(globalBit / 8)
    const bitIndex = globalBit % 8

    if (bit) rawData[byteIndex] |= 1 << bitIndex
    else rawData[byteIndex] &= ~(1 << bitIndex)
  }
}

function encodeSignal(rawData, { startBit, length, factor = 1, offset = 0 }, value) {
  const raw = (value - offset) / factor
  setUnsigned(rawData, startBit, length, raw)
}

function makeFrame(canId, timestamp, rawData) {
  const frame = Buffer.alloc(20)
  frame.writeUInt32LE(canId, 0)
  frame.writeDoubleLE(timestamp, 4)
  Buffer.from(rawData).copy(frame, 12)
  return frame
}

function makeMotorFrame(canId, t, phase) {
  const rawData = new Uint8Array(8)
  const rpm = wave(t, -2500, 9200, 1.5, phase)
  const torque = wave(t, -45, 240, 1.1, phase + 0.8)
  const power = wave(t, -18, 92, 1.25, phase + 1.4)
  const temp = wave(t, 34, 86, 0.38, phase + 0.5)

  encodeSignal(rawData, { startBit: 8, length: 16, factor: 1, offset: -32000 }, rpm)
  encodeSignal(rawData, { startBit: 24, length: 16, factor: 0.2, offset: -6400 }, torque)
  encodeSignal(rawData, { startBit: 40, length: 16, factor: 0.005, offset: -160 }, power)
  encodeSignal(rawData, { startBit: 56, length: 8, factor: 1, offset: -40 }, temp)

  return makeFrame(canId, nowSeconds(), rawData)
}

function makeDeviceFrame(canId, t, phase) {
  const rawData = new Uint8Array(8)
  const voltage = wave(t, 315, 388, 0.42, phase)
  const power = wave(t, -12, 118, 1.2, phase + 1.1)
  const temp = wave(t, 30, 72, 0.3, phase + 2.2)

  encodeSignal(rawData, { startBit: 0, length: 2 }, 1)
  encodeSignal(rawData, { startBit: 2, length: 2 }, 0)
  encodeSignal(rawData, { startBit: 32, length: 8, factor: 4 }, voltage)
  encodeSignal(rawData, { startBit: 40, length: 16, factor: 0.005, offset: -160 }, power)
  encodeSignal(rawData, { startBit: 56, length: 8, factor: 1, offset: -40 }, temp)

  return makeFrame(canId, nowSeconds(), rawData)
}

function makeVcuFrame(t) {
  const rawData = new Uint8Array(8)
  const aps = wave(t, 0, 100, 0.9)

  encodeSignal(rawData, { startBit: 0, length: 1 }, 0)
  encodeSignal(rawData, { startBit: 1, length: 1 }, 1)
  encodeSignal(rawData, { startBit: 2, length: 2 }, aps > 8 ? 0 : 1)
  encodeSignal(rawData, { startBit: 8, length: 3 }, aps > 5 ? 4 : 2)
  encodeSignal(rawData, { startBit: 16, length: 16, factor: 100 / 65535 }, aps)

  return makeFrame(0x18ff1515, nowSeconds(), rawData)
}

function makeImuFrame(canId, values) {
  const rawData = new Uint8Array(8)
  values.forEach((value, index) => {
    encodeSignal(rawData, { startBit: index * 16, length: 16, factor: 0.01 }, value)
  })

  return makeFrame(canId, nowSeconds(), rawData)
}

function makeFaultFrame(t) {
  const rawData = new Uint8Array(8)
  const pulse = Math.floor(t / 8) % 2

  encodeSignal(rawData, { startBit: 0, length: 1 }, 0)
  encodeSignal(rawData, { startBit: 1, length: 1 }, pulse)
  encodeSignal(rawData, { startBit: 2, length: 1 }, 0)
  encodeSignal(rawData, { startBit: 4, length: 1 }, 0)

  return makeFrame(0x00000103, nowSeconds(), rawData)
}

function buildTelemetryFrames() {
  const t = (Date.now() - startedAt) / 1000

  return [
    makeMotorFrame(0x18ff01ea, t, 0),
    makeMotorFrame(0x18ff02ea, t, 0.7),
    makeMotorFrame(0x18ff01f7, t, 1.3),
    makeMotorFrame(0x18ff02f7, t, 2.1),
    makeDeviceFrame(0x18ff00ea, t, 0.2),
    makeDeviceFrame(0x18ff00f7, t, 1.4),
    makeVcuFrame(t),
    makeImuFrame(0x00000001, [
      wave(t, -7, 7, 1.9),
      wave(t, -1.4, 1.4, 1.2, 0.8),
      wave(t, -6, 6, 1.7, 1.2),
      wave(t, -1.2, 1.2, 1.1, 1.7),
    ]),
    makeImuFrame(0x00000002, [
      wave(t, -10, 10, 1.5, 0.4),
      wave(t, -1.8, 1.8, 1.1, 1.9),
      wave(t, 0, 115, 0.8, 0.1),
      wave(t, -12, 12, 1, 2.3),
    ]),
    makeFaultFrame(t),
  ]
}

function sendWsBinaryFrame(socket, payload) {
  const header = []
  header.push(0x82)

  if (payload.length <= 125) {
    header.push(payload.length)
  } else if (payload.length <= 65535) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff)
  } else {
    header.push(127, 0, 0, 0, 0)
    header.push(
      (payload.length >> 24) & 0xff,
      (payload.length >> 16) & 0xff,
      (payload.length >> 8) & 0xff,
      payload.length & 0xff,
    )
  }

  socket.write(Buffer.concat([Buffer.from(header), payload]))
}

function handleCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

const server = http.createServer((request, response) => {
  handleCors(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'POST' && request.url === '/login') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true, token: 'mock-dev-token' }))
    return
  }

  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Mock telemetry backend is running.\n')
    return
  }

  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ ok: false, message: 'Not found' }))
})

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const token = url.searchParams.get('token')
  const key = request.headers['sec-websocket-key']

  if (url.pathname !== '/ws' || !token || !key) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized')
    socket.destroy()
    return
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}${WS_GUID}`)
    .digest('base64')

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  clients.add(socket)
  console.log(`WS conectado (${clients.size} cliente${clients.size === 1 ? '' : 's'})`)

  socket.on('close', () => {
    clients.delete(socket)
    console.log(`WS desconectado (${clients.size} cliente${clients.size === 1 ? '' : 's'})`)
  })

  socket.on('error', () => {
    clients.delete(socket)
  })
})

setInterval(() => {
  if (clients.size === 0) return

  const frames = buildTelemetryFrames()
  for (const client of clients) {
    if (client.destroyed) {
      clients.delete(client)
      continue
    }

    for (const frame of frames) {
      sendWsBinaryFrame(client, frame)
    }
  }
}, TICK_MS)

server.listen(PORT, () => {
  console.log(`Mock telemetry backend em http://localhost:${PORT}`)
  console.log(`POST /login retorna token de teste; WS /ws envia frames CAN binarios a cada ${TICK_MS}ms`)
})
