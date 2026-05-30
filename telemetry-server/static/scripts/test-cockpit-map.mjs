import { spawn } from 'node:child_process'
import net from 'node:net'

const MOCK_ENV = {
  ...process.env,
  MOCK_TELEMETRY_PORT: process.env.MOCK_TELEMETRY_PORT ?? '8081',
  MOCK_TELEMETRY_TICK_MS: process.env.MOCK_TELEMETRY_TICK_MS ?? '50',
  MOCK_TRACK_LAP_SEC: process.env.MOCK_TRACK_LAP_SEC ?? '6',
}

const children = []

function run(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  children.push(child)
  child.on('exit', (code, signal) => {
    if (signal) return
    if (code && code !== 0) {
      console.error(`[${name}] saiu com codigo ${code}`)
      shutdown(code)
    }
  })
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

function isPortInUse(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()

    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true)
      else reject(err)
    })

    probe.once('listening', () => {
      probe.close(() => resolve(false))
    })

    probe.listen(port, '0.0.0.0')
  })
}

console.log('\nTeste do cockpit com mapa/tracking mock')
console.log('1. Abra o URL do Vite que aparece abaixo.')
console.log('2. Faça login com admin para controle total ou member/membro para perfil de consumo.')
console.log('3. Clique em iniciar telemetria e abra a aba Cockpit.')
console.log(`4. O mapa fecha em ${MOCK_ENV.MOCK_TRACK_LAP_SEC}s e o ponto começa a andar.\n`)

const mockPort = Number(MOCK_ENV.MOCK_TELEMETRY_PORT)
const portInUse = await isPortInUse(mockPort)

if (portInUse) {
  console.log(`[mock-backend] porta ${mockPort} ja esta em uso; reutilizando backend existente.`)
} else {
  run('mock-backend', 'node', ['scripts/mock-telemetry-server.mjs'], { env: MOCK_ENV })
}

run('vite', 'npm', ['run', 'dev', '--', '--host', '0.0.0.0'])
