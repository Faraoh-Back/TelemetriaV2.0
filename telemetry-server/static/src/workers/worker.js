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
    // ── INS ──────────────────────────────────────────────────────────────────
    1: [ // INS_01
        { n: 'Accel_Linear_X', sb: 0,  len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'm/s²',  t: 'int', signed: true },
        { n: 'Velo_Angular_X', sb: 16, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'rad/s', t: 'int', signed: false },
        { n: 'Accel_Linear_Y', sb: 32, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'm/s²',  t: 'int', signed: false },
        { n: 'Velo_Angular_Y', sb: 48, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'rad/s', t: 'int', signed: false },
    ],
    2: [ // INS_02
        { n: 'Accel_Linear_Z', sb: 0,  len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'm/s²',  t: 'int', signed: false },
        { n: 'Velo_Angular_Z', sb: 16, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'rad/s', t: 'int', signed: false },
        { n: 'Speed_Linear_X', sb: 32, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'km/h',  t: 'int', signed: false },
        { n: 'Speed_Linear_Y', sb: 48, len: 16, bo: 'Intel', f: 0.01, o: 0, u: 'km/h',  t: 'int', signed: false },
    ],

    // ── VCU ──────────────────────────────────────────────────────────────────
    419370261: [ // 0x18FF1515 — VCU_DATA_OUT
        { n: 'APPS_RANGE_ERROR', sb: 0,  len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'SAFETY_OK',        sb: 8,  len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'int',  signed: false },
        { n: 'BRAKE',            sb: 16, len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'int',  signed: false },
        { n: 'VCU_STATE',        sb: 24, len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'int',  signed: false },
        { n: 'APS_PERC',         sb: 32, len: 8, bo: 'Intel', f: 1, o: 0, u: '%', t: 'int', signed: false },
        { n: 'HV_on',            sb: 40, len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'Buzzer',           sb: 48, len: 8, bo: 'Intel', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'APPS_PERC1',       sb: 56, len: 8, bo: 'Intel', f: 1, o: 0, u: '%', t: 'int', signed: false },
    ],

    // ── INVERSORES — SETPOINTS reais (IDs que chegam no banco) ───────────────
    419368426: [ // 0x18FF0DEA — SETPOINTS_CONTROL_0 (eixo 0)
        { n: 'RPM_0A',    sb: 16, len: 16, f: 1, o: 0, u: 'rpm', t: 'int', signed: true },
        { n: 'TORQUE_0B', sb: 32, len: 16, f: 1, o: 0, u: 'Nm',  t: 'int', signed: true },
        { n: 'RPM_0B',    sb: 48, len: 16, f: 1, o: 0, u: 'rpm', t: 'int', signed: true },
    ],
    419368695: [ // 0x18FF0EF7 — SEPOINT_CONTROL_13 (eixo 13)
        { n: 'TORQUE_13A', sb: 0,  len: 16, f: 1, o: 0, u: 'Nm',  t: 'int', signed: true },
        { n: 'RPM_13A',    sb: 16, len: 16, f: 1, o: 0, u: 'rpm', t: 'int', signed: true },
        { n: 'TORQUE_13B', sb: 32, len: 16, f: 1, o: 0, u: 'Nm',  t: 'int', signed: true },
        { n: 'RPM_13B',    sb: 48, len: 16, f: 1, o: 0, u: 'rpm', t: 'int', signed: true },
    ],

    // ── VCU FAULTS ───────────────────────────────────────────────────────────
    259: [ // 0x00000103 — Faults (decimal, não hex)
        { n: 'IMD',                    sb: 0,  len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS',                    sb: 8,  len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BSPD',                   sb: 16, len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'Safety_OK',              sb: 24, len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_TIMEOUT',            sb: 32, len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'PRE_CHARGE_TIME_EXCEEDED', sb: 40, len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'GENERAL ERROR',          sb: 48, len: 8, f: 1, o: 0, u: '', t: 'bool', signed: false },
    ],

    // ── BMS DIAGNOSTIC ───────────────────────────────────────────────────────
    431292423: [ // 0x19B50007 — Diagnostic_Codes_Ext (Motorola)
        { n: 'BMS_CellUnderVoltage',   sb: 0,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellOverVoltage',    sb: 1,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_DchrgOvrCurrent',    sb: 2,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_ChrgOverCurrent',    sb: 3,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellModOverHeat',    sb: 4,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_Leakage',            sb: 5,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_NoCellComm',         sb: 6,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_MS_ConfError',       sb: 7,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_MSIntCANError',      sb: 8,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_MSCommCANErr',       sb: 9,  len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_ChargerConnected',   sb: 10, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellOverHeat',       sb: 11, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_NoCurrentSensor',    sb: 12, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_PackUnderVoltage',   sb: 13, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_PackOverVoltage',    sb: 14, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellUnderHeat',      sb: 15, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellVoltDev',        sb: 16, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_PackVoltDev',        sb: 17, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellModUnderHeat',   sb: 18, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_ExtTempSensLoss',    sb: 19, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_Wirebreak',          sb: 20, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_ParStringVoltDev',   sb: 21, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_VoltExtTempValid',   sb: 22, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_VoltReadDev',        sb: 23, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_UnderVoltRed',       sb: 32, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_DischgOvrCurrRed',   sb: 33, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_ModOvrHeatRed',      sb: 34, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_MS_ConfMMRed',       sb: 35, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_MS_CanMalfRed',      sb: 36, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellOvrHeatRed',     sb: 37, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellVoltValidity',   sb: 56, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellModTempValid',   sb: 57, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellBalancValid',    sb: 58, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_NumOfCellsValid',    sb: 59, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_BatChrgFinished',    sb: 60, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
        { n: 'BMS_CellTempValid',      sb: 61, len: 1, bo: 'Motorola', f: 1, o: 0, u: '', t: 'bool', signed: false },
    ],

    // ── TENSÕES INDIVIDUAIS DE CÉLULA (Motorola, 8 células por frame) ─────────
    431292672: [ // 0x19B50100 — células 0-7
        { n: 'vcell_0', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_1', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_2', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_3', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_4', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_5', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_6', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_7', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292673: [ // 0x19B50101 — células 8-15
        { n: 'vcell_8',  sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_9',  sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_10', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_11', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_12', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_13', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_14', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_15', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292674: [ // 0x19B50102 — células 16-23
        { n: 'vcell_16', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_17', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_18', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_19', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_20', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_21', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_22', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_23', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292675: [ // 0x19B50103 — células 24-31
        { n: 'vcell_24', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_25', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_26', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_27', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_28', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_29', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_30', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_31', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292676: [ // 0x19B50104 — células 32-39
        { n: 'vcell_32', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_33', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_34', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_35', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_36', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_37', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_38', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_39', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292677: [ // 0x19B50105 — células 40-47
        { n: 'vcell_40', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_41', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_42', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_43', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_44', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_45', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_46', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_47', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292678: [ // 0x19B50106 — células 48-55
        { n: 'vcell_48', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_49', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_50', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_51', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_52', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_53', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_54', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_55', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292679: [ // 0x19B50107 — células 56-63
        { n: 'vcell_56', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_57', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_58', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_59', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_60', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_61', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_62', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_63', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292680: [ // 0x19B50108 — células 64-71
        { n: 'vcell_64', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_65', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_66', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_67', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_68', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_69', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_70', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_71', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292681: [ // 0x19B50109 — células 72-79
        { n: 'vcell_72', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_73', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_74', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_75', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_76', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_77', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_78', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_79', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292682: [ // 0x19B5010A — células 80-87
        { n: 'vcell_80', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_81', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_82', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_83', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_84', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_85', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_86', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_87', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],
    431292683: [ // 0x19B5010B — células 88-95
        { n: 'vcell_88', sb: 7,  len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_89', sb: 15, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_90', sb: 23, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_91', sb: 31, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_92', sb: 39, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_93', sb: 47, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_94', sb: 55, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
        { n: 'vcell_95', sb: 63, len: 8, bo: 'Motorola', f: 0.01, o: 2, u: 'V', t: 'float', signed: false },
    ],

    // ── TEMPERATURAS INDIVIDUAIS DE CÉLULA ────────────────────────────────────
    431294464: [ // 0x19B50800 — tcells 0-7
        { n: 'tcell_0', sb: 7,  len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_1', sb: 15, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_2', sb: 23, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_3', sb: 31, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_4', sb: 39, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_5', sb: 47, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_6', sb: 55, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_7', sb: 63, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
    ],
    431294466: [ // 0x19B50802 — tcells 16-23
        { n: 'tcell_16', sb: 7,  len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_17', sb: 15, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_18', sb: 23, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_19', sb: 31, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_20', sb: 39, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_21', sb: 47, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_22', sb: 55, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_23', sb: 63, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
    ],
    431294467: [ // 0x19B50803 — tcells 24-31
        { n: 'tcell_24', sb: 7,  len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_25', sb: 15, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_26', sb: 23, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_27', sb: 31, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_28', sb: 39, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_29', sb: 47, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_30', sb: 55, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
        { n: 'tcell_31', sb: 63, len: 8, bo: 'Motorola', f: 1, o: -100, u: '°C', t: 'int', signed: false },
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
