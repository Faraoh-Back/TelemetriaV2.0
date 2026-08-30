// src/store.js
//
// FLUXO:
//
//   worker.onmessage recebe { type: 'signals', items: [{ name, value, unit, timestamp }] }
//       │  (lote de ~20 Hz — o worker coalesce as amostras, ver workers/worker.js)
//       ▼
//   batch(() => setSignals(name, { value, unit, timestamp }) por item)
//       │
//       ▼
//   Componentes que leem signals[name] atualizam automaticamente
//   (SolidJS Proxy — só o nó DOM do sinal que mudou, sem re-render)
//
//
//   Componente chama requestBuffer(name, threshold, windowSeconds)
//       │
//       ▼
//   Promise criada, reqId gerado, registrado em bufferCallbacks
//       │
//       ▼
//   worker.onmessage recebe { type: 'buffer', reqId, ts, val }
//       │
//       ▼
//   bufferCallbacks.get(reqId)(data) → resolve() da Promise

import { batch } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { TRACK_MAP_ENABLED } from './config/featureFlags.js'

// ─── WORKER ──────────────────────────────────────────────────────────────────
// O Worker fica em src/workers para poder importar os utils do projeto.
// Vite resolve a URL e empacota o module worker junto com a aplicação.
const worker = new Worker(
    new URL('./workers/worker.js', import.meta.url),
    { type: 'module' }
)

// ─── ESTADO REATIVO ───────────────────────────────────────────────────────────
// signals: { [signal_name]: { value, unit, timestamp } }
// status:  { state: 'disconnected' | 'connecting' | 'connected' | 'error', frameRate: number }
// telemetrySession: timestamps absolutos da coleta atual.

const [signals, setSignals] = createStore({})
const [status, setStatus]   = createStore({ state: 'disconnected', frameRate: 0 })
const [trackState, setTrackState] = createStore({
    status: 'waiting',
    track: null,
    vehicle: null,
    path: null,
    quality: null,
    landmarks: [],
    timestamp: null,
})
const [lapState, setLapState] = createStore({
    lastLapTime: null,
    lastLapAt: null,
    allLaps: [],
    bestLaps: [],
    bestLap: null,
    lapCount: 0,
})

function formatLapTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return null
    const min = Math.floor(seconds / 60)
    const sec = (seconds % 60).toFixed(3)
    return `${min}:${sec.padStart(6, '0')}`
}

function readLapSeconds(entry) {
    if (typeof entry === 'number') return entry
    if (!entry || typeof entry !== 'object') return null

    const candidates = [
        entry.time,
        entry.time_sec,
        entry.time_seconds,
        entry.duration,
        entry.duration_sec,
        entry.duration_seconds,
        entry.lap_time,
        entry.lap_time_sec,
        entry.lap_time_seconds,
    ]

    const value = candidates.find((candidate) => Number.isFinite(Number(candidate)))
    return value == null ? null : Number(value)
}

function readLapNumber(entry, index) {
    if (!entry || typeof entry !== 'object') return index + 1

    const value = entry.lap ?? entry.lap_number ?? entry.number ?? entry.index
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : index + 1
}

function normalizeLapEntry(entry, index) {
    const time = readLapSeconds(entry)
    if (!Number.isFinite(time)) return null

    return {
        lap: readLapNumber(entry, index),
        time,
        formatted: entry?.formatted ?? entry?.display ?? formatLapTime(time),
    }
}

function normalizeBackendLaps(payload) {
    const rawLaps = payload.laps ?? payload.lap_times ?? payload.times ?? payload.items ?? []
    const laps = Array.isArray(rawLaps)
        ? rawLaps.map(normalizeLapEntry).filter(Boolean)
        : []

    const bestFromPayload = payload.best_lap ?? payload.bestLap ?? payload.best
    const bestLap = normalizeLapEntry(bestFromPayload, 0) ||
        laps.reduce((best, lap) => (!best || lap.time < best.time ? lap : best), null)

    return { laps, bestLap }
}

function applyBackendLapTimes(payload) {
    const { laps, bestLap } = normalizeBackendLaps(payload)
    if (!laps.length && !bestLap) return

    const allLaps = laps.length ? laps : [bestLap]
    const lastLap = allLaps[allLaps.length - 1] ?? null
    const bestLaps = [...allLaps].sort((a, b) => a.time - b.time).slice(0, 5)

    setLapState({
        lastLapTime: lastLap?.formatted ?? null,
        lastLapAt: Date.now(),
        allLaps,
        bestLaps,
        bestLap: bestLap ?? bestLaps[0] ?? null,
        lapCount: Number(payload.lap_count ?? payload.lapCount ?? allLaps.length),
    })
}

const [telemetrySession, setTelemetrySession] = createStore({
    startTimestamp: null,
    stopTimestamp: null,
})

// ─── MENSAGENS DO WORKER ──────────────────────────────────────────────────────
    worker.onmessage = ({ data }) => {
        switch (data.type) {
            // O worker agrega os sinais de uma janela e manda um lote só.
            // `batch()` garante uma única passada de efeitos por lote em vez de
            // uma por sinal — sem isso a StatusBar reexecutava suas agregações
            // (96 células) a cada amostra individual.
            case 'signals':
            batch(() => {
                for (const item of data.items) {
                    setSignals(item.name, {
                        value:     item.value,
                        unit:      item.unit,
                        timestamp: item.timestamp,
                        component: item.component,
                    })
                }
            })
            break

            case 'status':
            setStatus({ state: data.state, frameRate: data.frameRate })
            break

            case 'buffer':
            bufferCallbacks.get(data.reqId)?.(data)
            bufferCallbacks.delete(data.reqId)
            break

            case 'latest':
            latestCallback?.(data.snapshot)
            latestCallback = null
            break

            case 'session':
            setTelemetrySession({
                startTimestamp: data.startTimestamp ?? null,
                stopTimestamp: data.stopTimestamp ?? null,
            })
            break

            case 'collection_bounds':
            pendingCollectionBounds?.({
                log_start_unix: data.log_start_unix ?? null,
                log_stop_unix: data.log_stop_unix ?? null,
            })
            pendingCollectionBounds = null
            break

            case 'track':
            // Defesa em profundidade: o worker já descarta `track_*` com o
            // kill switch ligado, mas um servidor com TRACK_MAP_ENABLED=true
            // não deve ressuscitar as escritas em trackState no cliente.
            if (!TRACK_MAP_ENABLED) break
            if (data.payload?.type === 'track_status') {
                setTrackState({
                    status: data.payload.state || 'learning_first_lap',
                    timestamp: data.payload.timestamp ?? null,
                })
            } else if (data.payload?.type === 'track_map') {
                setTrackState({
                    status: data.payload.state || 'tracking',
                    track: data.payload.track ?? null,
                    timestamp: data.payload.timestamp ?? null,
                })
            } else if (data.payload?.type === 'track_pose') {
                setTrackState({
                    status: 'tracking',
                    vehicle: data.payload.vehicle ?? null,
                    timestamp: data.payload.timestamp ?? null,
                })
            } else if (data.payload?.type === 'track_path') {
                setTrackState({
                    path: data.payload.path ?? null,
                    timestamp: data.payload.timestamp ?? null,
                })
            } else if (data.payload?.type === 'track_quality') {
                setTrackState({
                    quality: data.payload.quality ?? null,
                    timestamp: data.payload.timestamp ?? null,
                })
            } else if (data.payload?.type === 'track_observations') {
                setTrackState({
                    landmarks: data.payload.landmarks ?? [],
                    timestamp: data.payload.timestamp ?? null,
                })
            }
            break

            case 'laps':
            applyBackendLapTimes(data.payload)
            break
        }
    }

    // ─── CALLBACKS PONTUAIS ───────────────────────────────────────────────────────
    // getBuffer é chamado pelos MotecCharts — cada chamada tem um reqId único
    // pra que respostas paralelas não se misturem.

    const bufferCallbacks = new Map()
    let   latestCallback  = null
    let   reqCounter      = 0
    let   pendingCollectionBounds = null

    // ─── API PÚBLICA ──────────────────────────────────────────────────────────────

    function readCanFrontDebugConfig() {
        return {
            enabled: localStorage.getItem('CAN_FRONT_DEBUG') === '1',
            ids: localStorage.getItem('CAN_FRONT_DEBUG_IDS') || '',
            signals: localStorage.getItem('CAN_FRONT_DEBUG_SIGNALS') || '',
            unmappedImmediate: localStorage.getItem('CAN_FRONT_DEBUG_UNMAPPED') !== '0',
            durationSeconds: Number(localStorage.getItem('CAN_FRONT_DEBUG_SECONDS') || '19'),
        }
    }

    export function refreshCanFrontDebugConfig() {
        worker.postMessage({
            cmd: 'setDebugConfig',
            config: readCanFrontDebugConfig(),
        })
    }
    
    export function connect(url, apiBase) {
        setStatus({ state: 'connecting', frameRate: 0 })
        refreshCanFrontDebugConfig()
        worker.postMessage({ cmd: 'loadCanMap', apiBase })
        worker.postMessage({ cmd: 'connect', url })
    }

    export function disconnect() {
        worker.postMessage({ cmd: 'disconnect' })
    }

    /**
     * Ao desligar a coleta, resolve com os limites do log no mesmo relógio dos frames.
     * @param {boolean} enabled
     * @returns {Promise<{ log_start_unix: number | null, log_stop_unix: number | null }>}
     */
    export function setTelemetryCollectionEnabled(enabled) {
        if (enabled) {
            worker.postMessage({
                cmd: 'setTelemetryCollectionEnabled',
                enabled: true,
            })
            return Promise.resolve({
                log_start_unix: null,
                log_stop_unix: null,
            })
        }

        return new Promise((resolve) => {
            pendingCollectionBounds = resolve
            worker.postMessage({
                cmd: 'setTelemetryCollectionEnabled',
                enabled: false,
            })
        })
    }

    export function resetTelemetryData() {
        setSignals(reconcile({}))
        setTrackState({
            status: 'waiting',
            track: null,
            vehicle: null,
            path: null,
            quality: null,
            landmarks: [],
            timestamp: null,
        })
        setTelemetrySession({
            startTimestamp: null,
            stopTimestamp: null,
        })
        setLapState({
            lastLapTime: null,
            lastLapAt: null,
            allLaps: [],
            bestLaps: [],
            bestLap: null,
            lapCount: 0,
        })
        worker.postMessage({ cmd: 'resetTelemetryData' })
    }

    export function requestBuffer(name, threshold = 500, windowSeconds = null) {
        return new Promise((resolve) => {
            const reqId = ++reqCounter
            bufferCallbacks.set(reqId, resolve)
            worker.postMessage({
                cmd: 'getBuffer',
                name,
                threshold,
                windowSeconds,
                reqId,
            })
        })
    }

    export function requestLatest(names) {
        return new Promise((resolve) => {
            latestCallback = resolve
            worker.postMessage({ cmd: 'getLatest', names })
        })
    }

    export { signals, status, telemetrySession, trackState, lapState }
