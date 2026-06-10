import { CircularBuffer, DEFAULT_BUFFER_SIZE } from '../utils/circularBuffer.js'
import { lttb } from '../utils/lttb.js'
import { decodeSignal } from '../utils/canDecode.js'

// =============================================================================
// worker.js — Web Worker de telemetria (thread isolada)
// =============================================================================
//
// POR QUE UM WEB WORKER?
//   O browser tem uma única thread principal responsável por layout, paint e
//   execução de JS da UI. Manter o WebSocket nessa thread significa que um
//   pico de render (ex: gráfico recalculando) pode atrasar o recebimento de
//   dados — e vice-versa: um burst de 130 frames/s trava a animação.
//   O Worker roda em thread separada: dados chegam e são processados
//   independentemente do que a UI estiver fazendo.
//
// FLUXO GERAL
//
//   Servidor Rust                  worker.js (esta thread)         UI / store.js
//   ─────────────                  ───────────────────────         ─────────────
//   envia frame binário  ───WS───► handleFrame()
//                                    │ 1. DataView lê can_id,
//                                    │    timestamp, raw_data
//                                    │ 2. CAN_MAP[can_id] →
//                                    │    lista de sinais
//                                    │ 3. decodeSignal() por sinal
//                                    │    (extractBits + fator + offset)
//                                    │ 4. CircularBuffer.push()
//                                    │ 5. postMessage('signal') ──────────► atualiza sinal reativo
//                                    │                                       no SolidJS store
//                                    │
//   store.js pede gráfico ──cmd────► self.onmessage('getBuffer')
//                                    │ 1. CircularBuffer.toArrays()
//                                    │ 2. lttb() reduz para N pontos
//                                    └─► postMessage('buffer',        ────► uPlot recebe dados
//                                        Transferable)                      sem cópia de memória
//
// PROTOCOLO BINÁRIO (frame WebSocket, little-endian, 20 bytes fixos):
//   bytes [0..3]   — u32  can_id
//   bytes [4..11]  — f64  timestamp (Unix epoch, segundos)
//   bytes [12..19] — u8×8 raw_data (payload CAN de 8 bytes)
//
// MENSAGENS RECEBIDAS (store.js → Worker):
//   { cmd: 'connect',    url }                    — abre WS autenticado
//   { cmd: 'disconnect' }                         — fecha sem reconectar
//   { cmd: 'getBuffer',  name, threshold, windowSeconds, reqId } — buffer LTTB sob demanda
//   { cmd: 'getLatest',  names }                  — snapshot para hidratação inicial
//
// MENSAGENS EMITIDAS (Worker → store.js):
//   { type: 'signal',  name, value, unit, timestamp, canId } — por frame decodificado
//   { type: 'buffer',  reqId, name, ts, val }                — resposta ao getBuffer
//   { type: 'latest',  snapshot }                            — resposta ao getLatest
//   { type: 'status',  state, frameRate }                    — estado da conexão WS
//
// =============================================================================

// ─── MAPA CAN ────────────────────────────────────────────────────────────────
// Tradução dos CSVs em csv_data/ para um objeto de lookup O(1) por can_id.
// Embutido aqui para evitar fetch em runtime e manter o Worker autossuficiente.
//
// Cada entrada: can_id (decimal) → array de descritores de sinal
//   n   — signal_name  (chave usada no store e na UI)
//   sb  — start_bit    (bit de início, LSB-first, igual ao decoder.rs)
//   len — length       (quantidade de bits)
//   f   — factor       (multiplicador: valor_físico = raw * f + o)
//   o   — offset
//   u   — unit         (string exibida na UI)
//   t   — value_type   ('int' | 'float' | 'bool')
//
// ATENÇÃO: as chaves do objeto são números decimais. Ex: 0x18FF01EA = 419365610.
// Se o backend adicionar novos CAN IDs, basta incluir a entrada aqui —
// nenhuma outra parte do código precisa mudar.

    const CAN_MAP = {};

    async function loadCanMap(apiBase) {
        try {
            const response = await fetch(`${apiBase}/api/can-map`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw = await response.json();
            // Converte chaves string para número (igual ao CAN_MAP estático)
            for (const key of Object.keys(CAN_MAP)) delete CAN_MAP[key];
            for (const [key, signals] of Object.entries(raw)) {
                CAN_MAP[Number(key)] = signals;
            }
        } catch (err) {
            console.error('[CAN_MAP] falha ao carregar do servidor:', err);
            self.postMessage({ type: 'can_map_error', error: String(err) });
        }
    }
    
    // ─── UTILS EXTRAIDOS ─────────────────────────────────────────────────────────
    // CircularBuffer, lttb e decodeSignal vivem em src/utils. O worker mantém o
    // CAN_MAP e orquestra WebSocket, buffers e mensagens para a UI.
    const BUFFER_SIZE = DEFAULT_BUFFER_SIZE;
    
    // ─── ESTADO DO WORKER ─────────────────────────────────────────────────────────
    // Variáveis de módulo — vivem na thread do Worker, invisíveis para a UI.
    //
    //   buffers      — um CircularBuffer por signal_name, criado na primeira amostra
    //   latest       — último valor de cada sinal (para hidratação da StatusBar)
    //   ws           — instância ativa do WebSocket
    //   wsUrl        — guardada para reconexão automática
    //   reconnectTimer — handle do setTimeout de reconexão (cancelado ao reconectar)
    //   frameCount / lastRateTs — contadores para o cálculo de taxa (frames/s)
    
    const buffers    = {};  // signal_name → CircularBuffer
    const latest     = {};  // signal_name → { value, unit, timestamp }
    let ws           = null;
    let wsUrl        = null;
    let reconnectTimer = null;
    let frameCount   = 0;
    let lastRateTs   = performance.now();
    let telemetryCollectionEnabled = false;
    let sessionStartTimestamp = null;
    let sessionStopTimestamp = null;
    let latestFrameTimestamp = null;
    let debugConfig = {
        enabled: false,
        ids: null,
        signals: null,
        unmappedImmediate: true,
        durationMs: 19000,
        startedAt: 0,
        ended: false,
    };
    let statsFrames = 0;
    let statsDecodedSignals = 0;
    let statsUnmappedFrames = 0;
    let statsUnmappedIds = new Map();
    let statsLastLogTs = performance.now();
    
    function getOrCreateBuffer(name) {
        if (!buffers[name]) buffers[name] = new CircularBuffer(BUFFER_SIZE);
        return buffers[name];
    }

    function parseCanIdList(value) {
        if (!value) return null;
        const ids = new Set();
        for (const item of String(value).split(',')) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const parsed = trimmed.toLowerCase().startsWith('0x')
                ? Number.parseInt(trimmed.slice(2), 16)
                : Number.parseInt(trimmed, 10);
            if (Number.isFinite(parsed)) ids.add(parsed >>> 0);
        }
        return ids.size > 0 ? ids : null;
    }

    function parseSignalList(value) {
        if (!value) return null;
        const signals = new Set(
            String(value)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
        );
        return signals.size > 0 ? signals : null;
    }

    function applyDebugConfig(config = {}) {
        const durationSeconds = Number(config.durationSeconds);
        debugConfig = {
            enabled: config.enabled === true || config.enabled === '1',
            ids: parseCanIdList(config.ids),
            signals: parseSignalList(config.signals),
            unmappedImmediate: config.unmappedImmediate !== false,
            durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
                ? durationSeconds * 1000
                : 19000,
            startedAt: performance.now(),
            ended: false,
        };
        statsFrames = 0;
        statsDecodedSignals = 0;
        statsUnmappedFrames = 0;
        statsUnmappedIds.clear();
        statsLastLogTs = performance.now();
        if (debugConfig.enabled) {
            console.info('[CAN_FRONT_DEBUG] ativo', {
                ids: debugConfig.ids ? Array.from(debugConfig.ids).map((id) => `0x${id.toString(16).toUpperCase()}`) : null,
                signals: debugConfig.signals ? Array.from(debugConfig.signals) : null,
                unmappedImmediate: debugConfig.unmappedImmediate,
                durationSeconds: debugConfig.durationMs / 1000,
                mappedIds: Object.keys(CAN_MAP).length,
            });
        }
    }

    function debugLogActive() {
        if (!debugConfig.enabled || debugConfig.ended) return false;

        if (performance.now() - debugConfig.startedAt <= debugConfig.durationMs) {
            return true;
        }

        debugConfig.ended = true;
        console.info(
            `[CAN_FRONT_STATS] final_${Math.round(debugConfig.durationMs / 1000)}s | frames=${statsFrames} sinais=${statsDecodedSignals} sem_mapa=${statsUnmappedFrames}`
        );
        if (statsUnmappedIds.size > 0) {
            console.warn(`[CAN_FRONT_UNMAPPED] resumo_final | ids=${formatIdCounts(statsUnmappedIds)}`);
        }
        return false;
    }

    function shouldDebugFrame(canId) {
        return debugLogActive() && (!debugConfig.ids || debugConfig.ids.has(canId));
    }

    function shouldDebugSignal(name) {
        return !debugConfig.signals || debugConfig.signals.has(name);
    }

    function formatRawData(rawData) {
        return Array.from(rawData)
            .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
            .join(' ');
    }

    function recordUnmapped(canId) {
        statsUnmappedFrames += 1;
        statsUnmappedIds.set(canId, (statsUnmappedIds.get(canId) || 0) + 1);
    }

    function formatIdCounts(map, limit = 20) {
        return Array.from(map.entries())
            .sort((a, b) => b[1] - a[1] || a[0] - b[0])
            .slice(0, limit)
            .map(([id, count]) => `0x${id.toString(16).toUpperCase()}/${id}=${count}`)
            .join(', ');
    }

    function maybeLogStats() {
        const now = performance.now();
        if (now - statsLastLogTs < 5000) return;

        if (debugLogActive()) {
            console.info(
                `[CAN_FRONT_STATS] frames=${statsFrames} sinais=${statsDecodedSignals} sem_mapa=${statsUnmappedFrames}`
            );
            if (statsUnmappedIds.size > 0) {
                console.warn(`[CAN_FRONT_UNMAPPED] resumo_5s | ids=${formatIdCounts(statsUnmappedIds)}`);
            }
        }

        statsFrames = 0;
        statsDecodedSignals = 0;
        statsUnmappedFrames = 0;
        statsUnmappedIds.clear();
        statsLastLogTs = now;
    }

    function resetTelemetryData() {
        for (const name of Object.keys(buffers)) delete buffers[name];
        for (const name of Object.keys(latest)) delete latest[name];
        frameCount = 0;
        lastRateTs = performance.now();
        sessionStartTimestamp = null;
        sessionStopTimestamp = null;
        latestFrameTimestamp = null;
        postSessionState();
    }

    function postSessionState() {
        self.postMessage({
            type: 'session',
            startTimestamp: sessionStartTimestamp,
            stopTimestamp: sessionStopTimestamp,
        });
    }
    
    // ─── PARSER DO FRAME BINÁRIO ──────────────────────────────────────────────────
    // Formato: [u32 can_id LE | f64 timestamp LE | u8×8 raw_data]
    
    function handleFrame(arrayBuffer) {
        if (!telemetryCollectionEnabled) return;
        if (arrayBuffer.byteLength < 20) return;
    
        const view    = new DataView(arrayBuffer);
        const canId   = view.getUint32(0, true);       // little-endian
        const timestamp = view.getFloat64(4, true);    // little-endian
        const rawData = new Uint8Array(arrayBuffer, 12, 8);
        const debugFrame = shouldDebugFrame(canId);
        statsFrames += 1;

        if (debugFrame) {
            console.info(
                `[CAN_FRONT_DEBUG] RX | id_dec=${canId} | id_hex=0x${canId.toString(16).toUpperCase()} | timestamp=${timestamp.toFixed(6)} | raw=[${formatRawData(rawData)}]`
            );
        }

        if (sessionStartTimestamp == null) {
        sessionStartTimestamp = timestamp;
        sessionStopTimestamp = null;
        postSessionState();
        }

        latestFrameTimestamp = timestamp;
    
        const signals = CAN_MAP[canId];
        if (!signals) {
            recordUnmapped(canId);
            if (debugFrame || (debugLogActive() && debugConfig.unmappedImmediate)) {
                console.warn(
                    `[CAN_FRONT_UNMAPPED] RX sem CAN_MAP | id_dec=${canId} | id_hex=0x${canId.toString(16).toUpperCase()} | raw=[${formatRawData(rawData)}]`
                );
            }
            maybeLogStats();
            return;
        }

        if (debugFrame) {
            console.info(
                `[CAN_FRONT_DEBUG] map match | id_dec=${canId} | id_hex=0x${canId.toString(16).toUpperCase()} | sinais=${signals.length}`
            );
        }
    
        for (const sig of signals) {
        const value = decodeSignal(rawData, sig);
        const name  = sig.n;
        statsDecodedSignals += 1;

        if (debugFrame && shouldDebugSignal(name)) {
            console.info(
                `[CAN_FRONT_DEBUG] decode | id=0x${canId.toString(16).toUpperCase()} | signal=${name} | sb=${sig.sb} | len=${sig.len} | order=${sig.bo || 'Intel'} | signed=${sig.signed === true} | factor=${sig.f} | offset=${sig.o} | final=${value} ${sig.u || ''}`
            );
        }
    
        getOrCreateBuffer(name).push(timestamp, value);
        latest[name] = { value, unit: sig.u, timestamp };
    
        // Notifica a UI com o valor mais recente (granular — por sinal)
        self.postMessage({ type: 'signal', name, value, unit: sig.u, timestamp, canId, component: sig.c });
        }
    
        // Taxa de frames (log a cada 5s)
        frameCount++;
        const now = performance.now();
        if (now - lastRateTs >= 5000) {
        const rate = (frameCount / ((now - lastRateTs) / 1000)).toFixed(1);
        self.postMessage({ type: 'status', state: 'connected', frameRate: parseFloat(rate) });
        frameCount  = 0;
        lastRateTs  = now;
        }

        maybeLogStats();
    }

    function handleTextMessage(text) {
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            return;
        }

        if (payload.type === 'track_status' || payload.type === 'track_map' || payload.type === 'track_pose') {
            self.postMessage({ type: 'track', payload });
            return;
        }

        if (!telemetryCollectionEnabled || !payload.signal_name) return;

        const name = payload.signal_name;
        const value = Number(payload.value);
        const timestamp = Number(payload.timestamp);
        if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return;

        getOrCreateBuffer(name).push(timestamp, value);
        latest[name] = { value, unit: payload.unit || '', timestamp };
        self.postMessage({
            type: 'signal',
            name,
            value,
            unit: payload.unit || '',
            timestamp,
            canId: payload.can_id,
        });
    }

    // ─── JANELA TEMPORAL ─────────────────────────────────────────────────────────
    // Recorta os arrays para os últimos N segundos antes do LTTB.
    //
    // Fluxo:
    //   CircularBuffer.toArrays()
    //      -> filterByTimeWindow()
    //      -> lttb()
    //      -> postMessage('buffer')
    
    function filterByTimeWindow(ts, val, windowSeconds) {
        if (!windowSeconds || ts.length === 0) return { ts, val };

        const latestTimestamp = ts[ts.length - 1];
        const startTimestamp = latestTimestamp - windowSeconds;
        let startIdx = 0;

        while (
        startIdx < ts.length - 1 &&
        ts[startIdx] < startTimestamp
        ) {
        startIdx++;
        }

        if (startIdx === 0) return { ts, val };

        return {
        ts: ts.slice(startIdx),
        val: val.slice(startIdx),
        };
    }
    
    // ─── WEBSOCKET ────────────────────────────────────────────────────────────────
    
    function connect(url) {
        if (ws) {
        ws.onclose = null; // evita reconexão dupla
        ws.close();
        }
    
        wsUrl = url;
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer'; // obrigatório para frames binários
    
        ws.onopen = () => {
        self.postMessage({ type: 'status', state: 'connected', frameRate: 0 });
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        frameCount = 0;
        lastRateTs = performance.now();
        };
    
        ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
            if (event.data.byteLength === 20) {
                // Frame CAN padrão (20 bytes fixos: 4b canId + 8b ts + 8b data)
                handleFrame(event.data);
            } else {
                // Backend também manda mensagens JSON (track_map, track_pose) encapsuladas em frames binários
                const text = new TextDecoder().decode(event.data);
                handleTextMessage(text);
            }
        } else if (typeof event.data === 'string') {
            handleTextMessage(event.data);
        } else if (event.data instanceof Blob) {
            event.data.text().then(handleTextMessage).catch(() => {});
        }
        };
    
        ws.onclose = () => {
        self.postMessage({ type: 'status', state: 'disconnected', frameRate: 0 });
        reconnectTimer = setTimeout(() => connect(wsUrl), 3000);
        };
    
        ws.onerror = () => {
        self.postMessage({ type: 'status', state: 'error', frameRate: 0 });
        };
    }
    
    // ─── MENSAGENS VINDAS DA UI ───────────────────────────────────────────────────
    // Comandos que o store.js pode enviar ao Worker:
    //
    //   { cmd: 'connect',    url: 'ws://...' }         → abre conexão autenticada
    //   { cmd: 'disconnect' }                           → fecha sem reconectar
    //   { cmd: 'getBuffer',  name, threshold, windowSeconds, reqId } → retorna buffer filtrado + LTTB
    //   { cmd: 'getLatest',  names }                    → retorna snapshot dos últimos valores
    
    self.onmessage = ({ data }) => {
        switch (data.cmd) {
        case 'setDebugConfig':
            applyDebugConfig(data.config || {});
            break;

        case 'loadCanMap':
            loadCanMap(data.apiBase);
            break;

        case 'connect':
            connect(data.url);
            break;

        case 'setTelemetryCollectionEnabled':
            telemetryCollectionEnabled = !!data.enabled;
            if (telemetryCollectionEnabled) {
            sessionStopTimestamp = null;
            postSessionState();
            }
            if (!telemetryCollectionEnabled) {
            frameCount = 0;
            sessionStopTimestamp = latestFrameTimestamp;
            postSessionState();
            self.postMessage({
                type: 'collection_bounds',
                log_start_unix: sessionStartTimestamp,
                log_stop_unix: sessionStopTimestamp,
            });
            self.postMessage({ type: 'status', state: ws ? 'connected' : 'disconnected', frameRate: 0 });
            }
            break;

        case 'resetTelemetryData':
            resetTelemetryData();
            break;
    
        case 'disconnect':
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            if (ws) { ws.onclose = null; ws.close(); ws = null; }
            telemetryCollectionEnabled = false;
            sessionStopTimestamp = latestFrameTimestamp;
            postSessionState();
            self.postMessage({ type: 'status', state: 'disconnected', frameRate: 0 });
            break;
    
        case 'getBuffer': {
            // Chamado pelos MotecCharts ao montar ou ao mudar janela temporal.
            // Transferable: passa o ArrayBuffer sem copiar memória.
            const buf = buffers[data.name];
            if (!buf || buf.count === 0) {
            self.postMessage({ type: 'buffer', reqId: data.reqId, name: data.name, ts: null, val: null });
            break;
            }
            const { ts, val } = buf.toArrays();
            const threshold   = data.threshold || 500;
            const windowed    = filterByTimeWindow(ts, val, data.windowSeconds);
            const reduced     = lttb(windowed.ts, windowed.val, threshold);
    
            // Transfere os ArrayBuffers (zero-copy)
            self.postMessage(
            { type: 'buffer', reqId: data.reqId, name: data.name, ts: reduced.ts, val: reduced.val },
            [reduced.ts.buffer, reduced.val.buffer]
            );
            break;
        }
    
        case 'getLatest': {
            // Snapshot dos valores mais recentes para hidratação inicial da StatusBar
            const snapshot = {};
            for (const name of data.names) {
            if (latest[name]) snapshot[name] = latest[name];
            }
            self.postMessage({ type: 'latest', snapshot });
            break;
        }
        }
    };
