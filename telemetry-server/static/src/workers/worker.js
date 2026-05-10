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

const CAN_MAP = {
    // ── IMU ──────────────────────────────────────────────────────────────────
    1: [ // 0x00000001
        { n: 'ventor_linear_acc_x',   sb: 0,  len: 16, f: 0.01, o: 0,  u: 'm/s²',  t: 'int', signed: true },
        { n: 'ventor_angular_speed_x', sb: 16, len: 16, f: 0.01, o: 0,  u: 'rad/s', t: 'int', signed: true },
        { n: 'ventor_linear_acc_y',   sb: 32, len: 16, f: 0.01, o: 0,  u: 'm/s²',  t: 'int', signed: true },
        { n: 'ventor_angular_speed_y', sb: 48, len: 16, f: 0.01, o: 0,  u: 'rad/s', t: 'int', signed: true },
    ],
    2: [ // 0x00000002
        { n: 'ventor_linear_acc_z',   sb: 0,  len: 16, f: 0.01, o: 0,  u: 'm/s²',  t: 'int', signed: true },
        { n: 'ventor_angular_speed_z', sb: 16, len: 16, f: 0.01, o: 0,  u: 'rad/s', t: 'int', signed: true },
        { n: 'ventor_linear_speed_x', sb: 32, len: 16, f: 0.01, o: 0,  u: 'km/h',  t: 'int', signed: true },
        { n: 'ventor_linear_speed_y', sb: 48, len: 16, f: 0.01, o: 0,  u: 'km/h',  t: 'int', signed: true },
    ],

    // ── PAINEL ───────────────────────────────────────────────────────────────
    0x410: [
        { n: 'fluid_temp_1',                          sb: 0,  len: 8, f: 2,    o: 0, u: '°C',  t: 'float' },
        { n: 'fluid_temp_2',                          sb: 8,  len: 8, f: 2,    o: 0, u: '°C',  t: 'float' },
        { n: 'fluid_temp_3',                          sb: 16, len: 8, f: 2,    o: 0, u: '°C',  t: 'float' },
        { n: 'susp_compression_front_left_suspension', sb: 24, len: 8, f: 2.55, o: 0, u: '%',   t: 'float' },
        { n: 'susp_compression_front_right_suspension',sb: 32, len: 8, f: 2.55, o: 0, u: '%',   t: 'float' },
        { n: 'brake_front_fluid_press',               sb: 40, len: 8, f: 1,    o: 0, u: 'Bar', t: 'float' },
    ],

    // ── PT ────────────────────────────────────────────────────────────────────
    0x400: [
        { n: 'fluid_temp_pt_1',       sb: 0,  len: 8, f: 2, o: 0, u: '°C',   t: 'float' },
        { n: 'fluid_temp_pt_2',       sb: 8,  len: 8, f: 2, o: 0, u: '°C',   t: 'float' },
        { n: 'fluid_temp_pt_3',       sb: 16, len: 8, f: 2, o: 0, u: '°C',   t: 'float' },
        { n: 'fluid_temp_pt_4',       sb: 24, len: 8, f: 2, o: 0, u: '°C',   t: 'float' },
        { n: 'fluid_flow_1',          sb: 32, len: 8, f: 8, o: 0, u: 'L/min', t: 'float' },
        { n: 'fluid_flow_2',          sb: 40, len: 8, f: 8, o: 0, u: 'L/min', t: 'float' },
        { n: 'brake_right_fluid_press',sb: 48, len: 8, f: 1, o: 0, u: 'Bar',  t: 'float' },
    ],
    0x402: [
        { n: 'susp_compression_back_left_suspension',  sb: 0,  len: 8, f: 2.55, o: 0, u: '%',   t: 'float' },
        { n: 'susp_compression_back_right_suspension', sb: 8,  len: 8, f: 2.55, o: 0, u: '%',   t: 'float' },
        { n: 'arref_right_fluid_press', sb: 16, len: 8, f: 2, o: 0, u: 'kPa', t: 'float' },
        { n: 'arref_left_fluid_press',  sb: 24, len: 8, f: 2, o: 0, u: 'kPa', t: 'float' },
    ],

    // ── VCU — Status master ───────────────────────────────────────────────────
    0x18FF1080: [
        { n: 'SystemEnable',            sb: 0,  len: 2,  f: 1,    o: 0, u: 'state', t: 'int' },
        { n: 'Clamp15_CAN',             sb: 2,  len: 2,  f: 1,    o: 0, u: 'state', t: 'int' },
        { n: 'setp_DcLinkVoltage',      sb: 8,  len: 8,  f: 0.25, o: 0, u: 'V',     t: 'int' },
        { n: 'VoltagePrechargeDemand',  sb: 24, len: 8,  f: 0.25, o: 0, u: 'V',     t: 'int' },
    ],

    // ── VCU — DATA OUT ────────────────────────────────────────────────────────
    0x18FF1515: [
        { n: 'APPS_RANGE_ERROR', sb: 0,  len: 1,  f: 1,      o: 0, u: 'state', t: 'bool' },
        { n: 'SAFETY_OK',        sb: 1,  len: 1,  f: 1,      o: 0, u: 'state', t: 'bool' },
        { n: 'BRAKE',            sb: 2,  len: 2,  f: 1,      o: 0, u: 'state', t: 'int'  },
        { n: 'VCU_STATE',        sb: 8,  len: 3,  f: 1,      o: 0, u: 'state', t: 'int'  },
        { n: 'APS_PERC',         sb: 16, len: 16, f: 100/65535, o: 0, u: '%',  t: 'float'},
    ],

    // ── VCU — Device status MOBILE 0 ─────────────────────────────────────────
    0x18FF00EA: [
        { n: 'DeviceState_M0',        sb: 0,  len: 2, f: 1,     o: 0,   u: 'state', t: 'int'   },
        { n: 'ErrorLamp_M0',          sb: 2,  len: 2, f: 1,     o: 0,   u: 'state', t: 'int'   },
        { n: 'act_DCBusVoltage_M0',   sb: 32, len: 8, f: 4,     o: 0,   u: 'V',     t: 'int'   },
        { n: 'act_DCBusPower_M0',     sb: 40, len: 16,f: 0.005, o: -160,u: 'kW',    t: 'float' },
        { n: 'act_DeviceTemperature_M0',sb:56,len: 8, f: 1,     o: -40, u: '°C',    t: 'int'   },
    ],

    // ── VCU — Device status MOBILE 13 ────────────────────────────────────────
    0x18FF00F7: [
        { n: 'DeviceState_M13',         sb: 0,  len: 2, f: 1,     o: 0,   u: 'state', t: 'int'   },
        { n: 'ErrorLamp_M13',           sb: 2,  len: 2, f: 1,     o: 0,   u: 'state', t: 'int'   },
        { n: 'act_DCBusVoltage_M13',    sb: 32, len: 8, f: 4,     o: 0,   u: 'V',     t: 'int'   },
        { n: 'act_DCBusPower_M13',      sb: 40, len: 16,f: 0.005, o: -160,u: 'kW',    t: 'float' },
        { n: 'act_DeviceTemperature_M13',sb:56, len: 8, f: 1,     o: -40, u: '°C',    t: 'int'   },
    ],

    // ── VCU — Actual values motor A0 ─────────────────────────────────────────
    0x18FF01EA: [
        { n: 'act_Speed_A0',           sb: 8,  len: 16, f: 1,     o: -32000, u: 'rpm', t: 'int'   },
        { n: 'act_Torque_A0',          sb: 24, len: 16, f: 0.2,   o: -6400,  u: 'Nm',  t: 'float' },
        { n: 'act_Power_A0',           sb: 40, len: 16, f: 0.005, o: -160,   u: 'kW',  t: 'float' },
        { n: 'act_MotorTemperature_A0',sb: 56, len: 8,  f: 1,     o: -40,    u: '°C',  t: 'int'   },
    ],

        // ── VCU — Actual values motor B0 ─────────────────────────────────────────
    0x18FF02EA: [
        { n: 'act_Speed_B0',           sb: 8,  len: 16, f: 1,     o: -32000, u: 'rpm', t: 'int'   },
        { n: 'act_Torque_B0',          sb: 24, len: 16, f: 0.2,   o: -6400,  u: 'Nm',  t: 'float' },
        { n: 'act_Power_B0',           sb: 40, len: 16, f: 0.005, o: -160,   u: 'kW',  t: 'float' },
        { n: 'act_MotorTemperature_B0',sb: 56, len: 8,  f: 1,     o: -40,    u: '°C',  t: 'int'   },
        ],
    
        // ── VCU — Actual values motor A13 ────────────────────────────────────────
    0x18FF01F7: [
        { n: 'act_Speed_A13',           sb: 8,  len: 16, f: 1,     o: -32000, u: 'rpm', t: 'int'   },
        { n: 'act_Torque_A13',          sb: 24, len: 16, f: 0.2,   o: -6400,  u: 'Nm',  t: 'float' },
        { n: 'act_Power_A13',           sb: 40, len: 16, f: 0.005, o: -160,   u: 'kW',  t: 'float' },
        { n: 'act_MotorTemperature_A13',sb: 56, len: 8,  f: 1,     o: -40,    u: '°C',  t: 'int'   },
        ],
    
        // ── VCU — Actual values motor B13 ────────────────────────────────────────
    0x18FF02F7: [
        { n: 'act_Speed_B13',           sb: 8,  len: 16, f: 1,     o: -32000, u: 'rpm', t: 'int'   },
        { n: 'act_Torque_B13',          sb: 24, len: 16, f: 0.2,   o: -6400,  u: 'Nm',  t: 'float' },
        { n: 'act_Power_B13',           sb: 40, len: 16, f: 0.005, o: -160,   u: 'kW',  t: 'float' },
        { n: 'act_MotorTemperature_B13',sb: 56, len: 8,  f: 1,     o: -40,    u: '°C',  t: 'int'   },
        ],
    
        // ── BMS — Diagnóstico ─────────────────────────────────────────────────────
    0x19B50007: [
        { n: 'BMS_Under_voltage',     sb: 0,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Over_voltage',      sb: 1,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Discharge_OC',      sb: 2,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Charge_OC',         sb: 3,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Cell_Overheat',     sb: 4,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Leakage',           sb: 5,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_No_Cell_Comm',      sb: 6,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'BMS_Pack_Under_Voltage',sb: 21, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        ],
    
        // ── LV BMS — Diagnóstico ──────────────────────────────────────────────────
    0x19B70007: [
        { n: 'LV_Under_voltage',      sb: 0,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'LV_Over_voltage',       sb: 1,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'LV_Discharge_OC',       sb: 2,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'LV_Charge_OC',          sb: 3,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'LV_Cell_Overheat',      sb: 4,  len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'LV_Pack_Under_Voltage', sb: 21, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        ],
    
        // ── ACD — Faults ──────────────────────────────────────────────────────────
    0x00000103: [
        { n: 'Fault_IMD',                    sb: 0, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_BMS',                    sb: 1, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_BSPD',                   sb: 2, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_Safety_OK',              sb: 3, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_General_Error',          sb: 4, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_PreCharge_Time_Exceeded',sb: 5, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        { n: 'Fault_BMS_Timeout',            sb: 6, len: 1, f: 1, o: 0, u: 'bool', t: 'bool' },
        ],
    };
    
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
    
    function getOrCreateBuffer(name) {
        if (!buffers[name]) buffers[name] = new CircularBuffer(BUFFER_SIZE);
        return buffers[name];
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

        if (sessionStartTimestamp == null) {
        sessionStartTimestamp = timestamp;
        sessionStopTimestamp = null;
        postSessionState();
        }

        latestFrameTimestamp = timestamp;
    
        const signals = CAN_MAP[canId];
        if (!signals) return;
    
        for (const sig of signals) {
        const value = decodeSignal(rawData, sig);
        const name  = sig.n;
    
        getOrCreateBuffer(name).push(timestamp, value);
        latest[name] = { value, unit: sig.u, timestamp };
    
        // Notifica a UI com o valor mais recente (granular — por sinal)
        self.postMessage({ type: 'signal', name, value, unit: sig.u, timestamp, canId });
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
            handleFrame(event.data);
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
