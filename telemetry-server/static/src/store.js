// src/store.js
//
// FLUXO:
//
//   worker.onmessage recebe { type: 'signal', name, value, unit, timestamp }
//       │
//       ▼
//   setSignals(name, { value, unit, timestamp })
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

import { createStore, reconcile } from 'solid-js/store'

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
    timestamp: null,
})
const [lapState, setLapState] = createStore({
    lastLapTime: null,
    lastLapAt: null,
    allLaps: [],
    bestLaps: [],
    lapCount: 0,
})

function formatLapTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return null
    const min = Math.floor(seconds / 60)
    const sec = (seconds % 60).toFixed(3)
    return `${min}:${sec.padStart(6, '0')}`
}

function updateLapDetection(vehicle, trackLength, timestamp) {
    if (!vehicle || !trackLength || trackLength <= 0) return
    if (!Number.isFinite(vehicle.distance_m)) return
    if (!Number.isFinite(timestamp)) return

    const currentLapNumber = Math.floor(vehicle.distance_m / trackLength)
    const prevLapNumber = lapState.lapCount ?? 0
    const lapStart = lapState._lapStart

    if (currentLapNumber > prevLapNumber) {
        const elapsed = lapStart != null ? timestamp - lapStart : null
        if (elapsed != null && elapsed > 0) {
            const formatted = formatLapTime(elapsed)
            const entry = { lap: currentLapNumber, time: elapsed, formatted }

            const updatedAll = [...lapState.allLaps, entry]
            const updatedBest = [...lapState.bestLaps, entry]
                .sort((a, b) => a.time - b.time)
                .slice(0, 5)

            setLapState({
                lastLapTime: formatted,
                lastLapAt: Date.now(),
                allLaps: updatedAll,
                bestLaps: updatedBest,
                lapCount: currentLapNumber,
                _lapStart: timestamp,
            })
        }
    } else if (currentLapNumber === prevLapNumber && !lapStart) {
        setLapState({ _lapStart: timestamp })
    }
}

const [telemetrySession, setTelemetrySession] = createStore({
    startTimestamp: null,
    stopTimestamp: null,
})

// ─── MENSAGENS DO WORKER ──────────────────────────────────────────────────────
    worker.onmessage = ({ data }) => {
        switch (data.type) {
            case 'signal':
            setSignals(data.name, {
                value:     data.value,
                unit:      data.unit,
                timestamp: data.timestamp,
                component: data.component,
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
                updateLapDetection(
                    data.payload.vehicle,
                    trackState.track?.length_m,
                    Number(data.payload.timestamp),
                )
            }
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
