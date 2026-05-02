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
//   Componente chama requestBuffer(name, threshold)
//       │
//       ▼
//   Promise criada, reqId gerado, registrado em bufferCallbacks
//       │
//       ▼
//   worker.onmessage recebe { type: 'buffer', reqId, ts, val }
//       │
//       ▼
//   bufferCallbacks.get(reqId)(data) → resolve() da Promise

import { createStore } from 'solid-js/store'

// ─── WORKER ──────────────────────────────────────────────────────────────────
// O Worker está em public/worker.js — servido como asset estático.
// { type: 'module' } não é necessário pois o worker.js é script clássico.
const worker = new Worker('/worker.js')

// ─── ESTADO REATIVO ───────────────────────────────────────────────────────────
// signals: { [signal_name]: { value, unit, timestamp } }
// status:  { state: 'disconnected' | 'connecting' | 'connected' | 'error', frameRate: number }

const [signals, setSignals] = createStore({})
const [status, setStatus]   = createStore({ state: 'disconnected', frameRate: 0 })

// ─── MENSAGENS DO WORKER ──────────────────────────────────────────────────────
    worker.onmessage = ({ data }) => {
        switch (data.type) {
            case 'signal':
            setSignals(data.name, {
                value:     data.value,
                unit:      data.unit,
                timestamp: data.timestamp,
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
        }
    }

    // ─── CALLBACKS PONTUAIS ───────────────────────────────────────────────────────
    // getBuffer é chamado pelos MotecCharts — cada chamada tem um reqId único
    // pra que respostas paralelas não se misturem.

    const bufferCallbacks = new Map()
    let   latestCallback  = null
    let   reqCounter      = 0

    // ─── API PÚBLICA ──────────────────────────────────────────────────────────────

    export function connect(url) {
        setStatus({ state: 'connecting', frameRate: 0 })
        worker.postMessage({ cmd: 'connect', url })
    }

    export function disconnect() {
        worker.postMessage({ cmd: 'disconnect' })
    }

    export function requestBuffer(name, threshold = 500) {
        return new Promise((resolve) => {
            const reqId = ++reqCounter
            bufferCallbacks.set(reqId, resolve)
            worker.postMessage({ cmd: 'getBuffer', name, threshold, reqId })
        })
    }

    export function requestLatest(names) {
        return new Promise((resolve) => {
            latestCallback = resolve
            worker.postMessage({ cmd: 'getLatest', names })
        })
    }

    export { signals, status }