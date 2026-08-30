import { CircularBuffer, DEFAULT_BUFFER_SIZE } from '../utils/circularBuffer.js'
import { lttb } from '../utils/lttb.js'
import { decodeSignal } from '../utils/canDecode.js'
import { TRACK_MAP_ENABLED } from '../config/featureFlags.js'

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
//   { type: 'signals', items: [{ name, value, unit, timestamp, canId, component }] }
//                                                            — lote de ~20 Hz (ver COALESCÊNCIA)
//   { type: 'buffer',  reqId, name, ts, val }                — resposta ao getBuffer
//   { type: 'latest',  snapshot }                            — resposta ao getLatest
//   { type: 'status',  state, frameRate }                    — estado da conexão WS
//
// COALESCÊNCIA DE SINAIS (por que não um postMessage por sinal):
//   O mapa CAN tem ~350 IDs e ~5k sinais. O servidor já limita o WS a 20 Hz por
//   CAN ID, mas cada frame decodifica vários sinais — na prática passava de 5k
//   postMessage/s. Cada um é uma structured clone, uma task na main thread e uma
//   escrita no store do Solid, que dispara os efeitos da UI. Era esse o caminho
//   que saturava a thread principal e aparecia como latência no dashboard.
//
//   Agora as amostras são acumuladas em `pendingSignals` (Map name → última
//   amostra) e despachadas em um único postMessage a cada UI_FLUSH_INTERVAL_MS.
//   O CircularBuffer continua recebendo 100% das amostras a cada frame, então os
//   gráficos não perdem resolução — só a UI de valor instantâneo é coalescida,
//   e ela não consegue exibir mais que ~20 Hz de qualquer forma.
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

    // ─── COALESCÊNCIA DE SINAIS PARA A UI ────────────────────────────────────
    // 50 ms = 20 Hz, a mesma taxa do throttle por CAN ID no servidor
    // (ingest.rs). Despachar mais rápido que isso só geraria lotes vazios.
    const UI_FLUSH_INTERVAL_MS = 50;
    const pendingSignals = new Map();  // signal_name → objeto de `latest` (reusado)
    let uiFlushTimer = null;

    function flushSignals() {
        uiFlushTimer = null;
        if (pendingSignals.size === 0) return;

        const items = Array.from(pendingSignals.values());
        pendingSignals.clear();
        self.postMessage({ type: 'signals', items });
    }

    function scheduleSignalFlush() {
        if (uiFlushTimer !== null) return;
        uiFlushTimer = setTimeout(flushSignals, UI_FLUSH_INTERVAL_MS);
    }

    const SIGNAL_ALIASES = {
        APPS_PERC: ['APS_PERC'],
        VoltOverallParam_MinCellVoltage: ['CELL_VOLTAGE_MIN'],
        VoltOverallParam_MaxCellVoltage: ['CELL_VOLTAGE_MAX'],
        CellOverallPar_MinCellTemp: ['CELL_TEMP_MIN'],
        CellOverallPar_MaxCellTemp: ['CELL_TEMP_MAX'],
        SAFETY_OK: ['SAFETY_NOT_OK'],
    };

    const BMS_VOLTAGE_RANGE_START = 0x19B50100;
    const BMS_VOLTAGE_RANGE_END = 0x19B5010B;
    const BMS_TEMPERATURE_RANGE_START = 0x19B50800;
    const BMS_TEMPERATURE_RANGE_END = 0x19B5080B;
    const BMS_GROUPED_VOLTAGE_ID = 0x19B5000B;
    const BMS_GROUPED_TEMPERATURE_ID = 0x19B5000E;

    function parseTrailingIndex(name) {
        const idx = Number.parseInt(name.split('_').pop(), 10);
        return Number.isFinite(idx) ? idx : null;
    }

    function emitIndexedBmsCell(prefix, idx, value, unit, timestamp, canId, component) {
        if (idx == null || idx < 0 || idx >= 96) return;
        emitSignal(`${prefix}_${idx}`, value, unit, timestamp, canId, component);
    }

    function expandedBmsCellIndex(messageIndex, signalIdx) {
        if (messageIndex == null || signalIdx == null || signalIdx < 0) return null;
        return signalIdx >= 8 ? signalIdx : messageIndex * 8 + signalIdx;
    }

    function groupedBmsCellIndex(groupValue, signalIdx) {
        if (groupValue == null || signalIdx == null || signalIdx <= 0) return null;
        const group = Math.max(0, Math.trunc(groupValue));
        const normalizedGroup = group > 0 ? group - 1 : 0;
        return normalizedGroup * 7 + (signalIdx - 1);
    }

    function emitSignal(name, value, unit, timestamp, canId, component) {
        getOrCreateBuffer(name).push(timestamp, value);

        // Um único objeto por signal_name, mutado no lugar: o Map já deduplica
        // por nome, então alocar um descritor novo por amostra só geraria lixo
        // no caminho quente. O postMessage faz structured clone na hora do
        // flush, portanto não há aliasing entre as threads.
        let entry = latest[name];
        if (entry === undefined) {
            entry = { name, value, unit, timestamp, canId, component };
            latest[name] = entry;
        } else {
            entry.value = value;
            entry.unit = unit;
            entry.timestamp = timestamp;
            entry.canId = canId;
            entry.component = component;
        }

        pendingSignals.set(name, entry);
        scheduleSignalFlush();
    }

    function emitInsSpeedFromFrame(name, frameValues, timestamp, canId, component) {
        const legacyFrameReady = name === 'Speed_Linear_Y'
            && frameValues?.has('Speed_Linear_X')
            && frameValues?.has('Speed_Linear_Y');
        const nedFrameReady = name === 'VELOCITY_E'
            && frameValues?.has('VELOCITY_N')
            && frameValues?.has('VELOCITY_E');

        if (!legacyFrameReady && !nedFrameReady) return;

        const x = legacyFrameReady
            ? frameValues.get('Speed_Linear_X')
            : frameValues.get('VELOCITY_N');
        const y = legacyFrameReady
            ? frameValues.get('Speed_Linear_Y')
            : frameValues.get('VELOCITY_E');

        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        emitSignal('INS_SPEED', Math.hypot(x, y), 'm/s', timestamp, canId, component);
    }

    function emitSignalWithAliases(name, value, unit, timestamp, canId, component, frameValues) {
        emitSignal(name, value, unit, timestamp, canId, component);
        for (const alias of SIGNAL_ALIASES[name] || []) {
            emitSignal(alias, value, unit, timestamp, canId, component);
        }

        if (name === 'ACCEL_X') {
            emitSignal('Accel_Linear_X', value, unit || 'm/s^2', timestamp, canId, component);
        } else if (name === 'ACCEL_Y') {
            emitSignal('Accel_Linear_Y', value, unit || 'm/s^2', timestamp, canId, component);
        } else if (name === 'ACCEL_Z') {
            emitSignal('Accel_Linear_Z', value, unit || 'm/s^2', timestamp, canId, component);
        } else if (name === 'GYRO_Z') {
            emitSignal('Velo_Angular_Z', value, unit || 'rad/s', timestamp, canId, component);
        } else if (name === 'VELOCITY_N') {
            emitSignal('Speed_Linear_X', value, unit || 'm/s', timestamp, canId, component);
        } else if (name === 'VELOCITY_E') {
            emitSignal('Speed_Linear_Y', value, unit || 'm/s', timestamp, canId, component);
        }

        emitInsSpeedFromFrame(name, frameValues, timestamp, canId, component);

        // Inverter Speed & Torque dynamic aliases to map to Dashboard config names
        if (name === 'act_Speed_A1') {
            emitSignal('RPM_0A', value, 'rpm', timestamp, canId, component);
        } else if (name === 'act_Speed_B1') {
            emitSignal('RPM_0B', value, 'rpm', timestamp, canId, component);
        } else if (name === 'act_Speed_A14') {
            emitSignal('RPM_13A', value, 'rpm', timestamp, canId, component);
        } else if (name === 'act_Speed_B14') {
            emitSignal('RPM_13B', value, 'rpm', timestamp, canId, component);
        } else if (name === 'act_Torque_A1') {
            emitSignal('TORQUE_0A', value, 'Nm', timestamp, canId, component);
        } else if (name === 'act_Torque_B1') {
            emitSignal('TORQUE_0B', value, 'Nm', timestamp, canId, component);
        } else if (name === 'act_Torque_A14') {
            emitSignal('TORQUE_13A', value, 'Nm', timestamp, canId, component);
        } else if (name === 'act_Torque_B14') {
            emitSignal('TORQUE_13B', value, 'Nm', timestamp, canId, component);
        }

        // BMS Cell Voltages: supports both expanded IDs and grouped EMUS ID.
        if (canId >= BMS_VOLTAGE_RANGE_START && canId <= BMS_VOLTAGE_RANGE_END) {
            if (name.startsWith('IndividualCellVoltage_Data_')) {
                const signalIdx = parseTrailingIndex(name);
                const msgIdx = canId - BMS_VOLTAGE_RANGE_START;
                emitIndexedBmsCell('vcell', expandedBmsCellIndex(msgIdx, signalIdx), value, 'V', timestamp, canId, component);
            }
        } else if (canId === BMS_GROUPED_VOLTAGE_ID) {
            if (name.startsWith('IndividualCellVoltage_Data_')) {
                const signalIdx = parseTrailingIndex(name);
                const cellIdx = groupedBmsCellIndex(frameValues?.get('IndividualCell_Group'), signalIdx);
                emitIndexedBmsCell('vcell', cellIdx, value, 'V', timestamp, canId, component);
            }
        }

        // BMS Cell Temperatures: supports both expanded IDs and grouped EMUS ID.
        if (canId >= BMS_TEMPERATURE_RANGE_START && canId <= BMS_TEMPERATURE_RANGE_END) {
            if (name.startsWith('IndividualCellTemp_Data_')) {
                const signalIdx = parseTrailingIndex(name);
                const msgIdx = canId - BMS_TEMPERATURE_RANGE_START;
                emitIndexedBmsCell('tcell', expandedBmsCellIndex(msgIdx, signalIdx), value, '°C', timestamp, canId, component);
            }
        } else if (canId === BMS_GROUPED_TEMPERATURE_ID) {
            if (name.startsWith('IndividualCellTemp_Data_')) {
                const signalIdx = parseTrailingIndex(name);
                const cellIdx = groupedBmsCellIndex(frameValues?.get('IndividualCell_Group'), signalIdx);
                emitIndexedBmsCell('tcell', cellIdx, value, '°C', timestamp, canId, component);
            }
        }
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
        pendingSignals.clear();
        if (uiFlushTimer !== null) { clearTimeout(uiFlushTimer); uiFlushTimer = null; }
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

        if (canId !== 0x700) {
            if (sessionStartTimestamp == null) {
                sessionStartTimestamp = timestamp;
                sessionStopTimestamp = null;
                postSessionState();
            }
            latestFrameTimestamp = timestamp;
        }
    
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
    
        const decodedSignals = [];
        const frameValues = new Map();

        for (const sig of signals) {
            const value = decodeSignal(rawData, sig);
            const name  = sig.n;
            decodedSignals.push({ sig, name, value });
            frameValues.set(name, value);
            statsDecodedSignals += 1;

            if (debugFrame && shouldDebugSignal(name)) {
                console.info(
                    `[CAN_FRONT_DEBUG] decode | id=0x${canId.toString(16).toUpperCase()} | signal=${name} | sb=${sig.sb} | len=${sig.len} | order=${sig.bo || 'Intel'} | signed=${sig.signed === true} | factor=${sig.f} | offset=${sig.o} | final=${value} ${sig.u || ''}`
                );
            }
        }

        for (const { sig, name, value } of decodedSignals) {
            emitSignalWithAliases(name, value, sig.u, timestamp, canId, sig.c, frameValues);
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

    const TRACK_MESSAGE_TYPES = new Set([
        'track_status',
        'track_map',
        'track_pose',
        'track_path',
        'track_quality',
        'track_observations',
    ]);
    const LAP_MESSAGE_TYPES = new Set([
        'lap_times',
        'laps',
        'track_laps',
        'lap_update',
    ]);

    function handleTextMessage(text) {
        // Kill switch do mapa: descarta antes do JSON.parse. O payload de
        // `track_map` carrega centenas de pontos — parseá-lo só para jogar fora
        // é exatamente o custo que o kill switch existe para evitar.
        if (!TRACK_MAP_ENABLED && text.includes('"track_') && !text.includes('"track_laps"')) return;

        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            return;
        }

        if (TRACK_MESSAGE_TYPES.has(payload.type)) {
            self.postMessage({ type: 'track', payload });
            return;
        }

        if (LAP_MESSAGE_TYPES.has(payload.type)) {
            self.postMessage({ type: 'laps', payload });
            return;
        }

        if (!telemetryCollectionEnabled || !payload.signal_name) return;

        const value = Number(payload.value);
        const timestamp = Number(payload.timestamp);
        if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return;

        emitSignal(
            payload.signal_name,
            value,
            payload.unit || '',
            timestamp,
            payload.can_id,
            undefined,
        );
    }

    // ─── JANELA TEMPORAL ─────────────────────────────────────────────────────────
    // O recorte dos últimos N segundos é feito dentro do próprio CircularBuffer,
    // que copia só a cauda da janela em vez de materializar as 3900 amostras
    // para o worker fatiar depois.
    //
    // Fluxo:
    //   CircularBuffer.toArrays(since)
    //      -> lttb()
    //      -> postMessage('buffer')

    // ─── WEBSOCKET ────────────────────────────────────────────────────────────────

    // Instância única: alocar um TextDecoder por mensagem é desperdício no
    // caminho quente e o decoder é stateless entre chamadas de decode().
    const textDecoder = new TextDecoder();

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
                handleTextMessage(textDecoder.decode(event.data));
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
            // Entrega o lote pendente antes de parar: sem isso as últimas
            // amostras da sessão morreriam na janela de coalescência.
            flushSignals();
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
            flushSignals();
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
            const since       = data.windowSeconds ? buf.lastTimestamp - data.windowSeconds : null;
            const { ts, val } = buf.toArrays(since);
            const threshold   = data.threshold || 500;
            const reduced     = lttb(ts, val, threshold);
    
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
