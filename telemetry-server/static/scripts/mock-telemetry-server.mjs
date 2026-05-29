import crypto from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.MOCK_TELEMETRY_PORT ?? 8081)
const TICK_MS = Number(process.env.MOCK_TELEMETRY_TICK_MS ?? 50)
const TRACK_LAP_SEC = Number(process.env.MOCK_TRACK_LAP_SEC ?? 8)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const clients = new Map()
const startedAt = Date.now()
const mockLogs = [
  {
    id: 'mock-log-001',
    name: 'Treino mock - stint 1',
    created_at: new Date(startedAt).toISOString(),
    started_at: new Date(startedAt - 9 * 60_000).toISOString(),
    ended_at: new Date(startedAt - 2 * 60_000).toISOString(),
    duration_seconds: 420,
    format: 'csv',
    content_type: 'text/csv',
    size_bytes: 4096,
    status: 'ready',
    download_url: null,
    metadata: {
      vehicle: 'EV',
      driver: 'Mock',
      source: 'mock-telemetry-server',
    },
  },
]

function nowSeconds() {
  return Date.now() / 1000
}

function base64UrlJson(payload) {
  return Buffer.from(JSON.stringify(payload))
    .toString('base64url')
}

function createMockToken(username, role, permissions) {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson({
      sub: username,
      username,
      role,
      permissions,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    }),
    'mock-signature',
  ].join('.')
}

function getPayloadFromRequest(request) {
  const auth = request.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const [, payload] = token.split('.')

  if (!payload) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function hasPermission(request, permission) {
  return getPayloadFromRequest(request)?.permissions?.includes(permission) ?? false
}

function requirePermission(request, response, permission) {
  if (hasPermission(request, permission)) return true

  sendJson(response, 403, {
    ok: false,
    message: 'Permissao insuficiente.',
  })
  return false
}

function getRoleForUsername(username) {
  return ['member', 'membro'].includes(String(username).toLowerCase())
    ? 'member'
    : 'admin'
}

function getPermissionsForRole(role) {
  if (role === 'member') return ['logs:read', 'logs:download']

  return [
    'telemetry:start',
    'telemetry:stop',
    'logs:read',
    'logs:download',
  ]
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
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

function sendWsTextFrame(socket, text) {
  const payload = Buffer.from(text)
  const header = []
  header.push(0x81)

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

function buildTrackPoints(count = 180) {
  const points = []
  for (let i = 0; i < count; i += 1) {
    const theta = (i / (count - 1)) * Math.PI * 2
    const radiusRipple = 1 + 0.11 * Math.sin(theta * 3.0)
    const x = 0.5 + Math.cos(theta) * 0.38 * radiusRipple
    const y = 0.5 + Math.sin(theta) * 0.28 * (1 + 0.07 * Math.cos(theta * 2.0))
    points.push([Number(x.toFixed(4)), Number(y.toFixed(4))])
  }
  return points
}

const mockTrack = {
  points: buildTrackPoints(),
  bounds: { minX: -45, maxX: 45, minY: -32, maxY: 32 },
  length_m: 286,
}

function interpolateTrackPoint(progress) {
  const points = mockTrack.points
  const position = progress * (points.length - 1)
  const idx = Math.floor(position)
  const nextIdx = (idx + 1) % points.length
  const alpha = position - idx
  const [x0, y0] = points[idx]
  const [x1, y1] = points[nextIdx]
  return {
    x: x0 + (x1 - x0) * alpha,
    y: y0 + (y1 - y0) * alpha,
  }
}

function buildTrackStatus(t) {
  return {
    type: 'track_status',
    state: 'learning_first_lap',
    timestamp: nowSeconds(),
    elapsed_sec: Number(t.toFixed(2)),
    lap_period_sec: TRACK_LAP_SEC,
    points: Math.max(1, Math.floor((t / TRACK_LAP_SEC) * mockTrack.points.length)),
  }
}

function buildTrackMap() {
  return {
    type: 'track_map',
    timestamp: nowSeconds(),
    lap_period_sec: TRACK_LAP_SEC,
    track: mockTrack,
  }
}

function buildTrackPose(t) {
  const trackTime = Math.max(0, t - TRACK_LAP_SEC)
  const progress = (trackTime / 10) % 1
  const vehicle = interpolateTrackPoint(progress)
  const next = interpolateTrackPoint((progress + 0.01) % 1)
  const heading = Math.atan2(next.y - vehicle.y, next.x - vehicle.x) * 180 / Math.PI

  return {
    type: 'track_pose',
    timestamp: nowSeconds(),
    vehicle: {
      x: Number(vehicle.x.toFixed(4)),
      y: Number(vehicle.y.toFixed(4)),
      x_m: Number(((vehicle.x - 0.5) * 90).toFixed(2)),
      y_m: Number(((vehicle.y - 0.5) * 64).toFixed(2)),
      heading: Number(heading.toFixed(1)),
      speed: Number(wave(t, 12, 31, 0.7).toFixed(2)),
      distance_m: Number((trackTime * 22).toFixed(1)),
    },
  }
}

function handleCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Expose-Headers', 'content-disposition')
}

const server = http.createServer(async (request, response) => {
  handleCors(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'POST' && request.url === '/login') {
    const body = await readJsonBody(request)
    const username = body.username || 'admin'
    const role = getRoleForUsername(username)
    const permissions = getPermissionsForRole(role)
    const token = createMockToken(username, role, permissions)

    sendJson(response, 200, {
      ok: true,
      token,
      user: {
        username,
        role,
        permissions,
      },
    })
    return
  }

  if (request.method === 'POST' && request.url === '/telemetry/collection/start') {
    if (!requirePermission(request, response, 'telemetry:start')) return
    sendJson(response, 200, { ok: true, state: 'live' })
    return
  }

  if (request.method === 'POST' && request.url === '/telemetry/collection/stop') {
    if (!requirePermission(request, response, 'telemetry:stop')) return
    sendJson(response, 200, { ok: true, state: 'stopped' })
    return
  }

  if (request.method === 'POST' && request.url === '/telemetry/log-session-bounds') {
    if (!requirePermission(request, response, 'telemetry:stop')) return
    const body = await readJsonBody(request)
    sendJson(response, 200, {
      ok: true,
      id: `mock-log-${Date.now()}`,
      status: 'processing',
      received: body,
    })
    return
  }

  if (request.method === 'GET' && request.url.startsWith('/telemetry/logs')) {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const downloadMatch = url.pathname.match(/^\/telemetry\/logs\/([^/]+)\/download$/)

    if (downloadMatch) {
      const log = mockLogs.find((item) => item.id === downloadMatch[1])

      if (!log) {
        sendJson(response, 404, { ok: false, message: 'Log nao encontrado.' })
        return
      }

      response.writeHead(200, {
        'Content-Type': log.content_type,
        'Content-Disposition': `attachment; filename="${log.id}.${log.format}"`,
      })
      response.end('timestamp,signal,value\n0,act_Speed_A0,4200\n1,act_Speed_A0,4300\n')
      return
    }

    sendJson(response, 200, {
      ok: true,
      items: mockLogs,
      next_cursor: null,
    })
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

  clients.set(socket, { mapSent: false, connectedAt: Date.now() })
  sendWsTextFrame(socket, JSON.stringify({
    type: 'track_status',
    state: 'learning_first_lap',
    timestamp: nowSeconds(),
    elapsed_sec: 0,
    lap_period_sec: TRACK_LAP_SEC,
    points: 1,
  }))
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
  const t = (Date.now() - startedAt) / 1000

  for (const [client, state] of clients) {
    if (client.destroyed) {
      clients.delete(client)
      continue
    }

    const clientElapsed = (Date.now() - state.connectedAt) / 1000
    if (clientElapsed < TRACK_LAP_SEC) {
      sendWsTextFrame(client, JSON.stringify(buildTrackStatus(clientElapsed)))
    } else if (!state.mapSent) {
      sendWsTextFrame(client, JSON.stringify(buildTrackMap()))
      state.mapSent = true
      sendWsTextFrame(client, JSON.stringify(buildTrackPose(clientElapsed)))
    } else {
      sendWsTextFrame(client, JSON.stringify(buildTrackPose(clientElapsed)))
    }

    for (const frame of frames) {
      sendWsBinaryFrame(client, frame)
    }
  }
}, TICK_MS)

server.listen(PORT, () => {
  console.log(`Mock telemetry backend em http://localhost:${PORT}`)
  console.log(`POST /login aceita admin ou member/membro; WS /ws envia frames CAN binarios a cada ${TICK_MS}ms`)
  console.log(`Mapa mock: primeira volta fecha em ${TRACK_LAP_SEC}s; depois envia track_pose em tempo real`)
})
