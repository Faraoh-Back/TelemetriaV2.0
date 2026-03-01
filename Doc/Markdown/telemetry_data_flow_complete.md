# DOCUMENTAÇÃO COMPLETA: FLUXO DE DADOS TELEMETRIA V2.1 E-RACING

**Versão:** 2.1 Data Flow Analysis  
**Data:** 16 de Fevereiro de 2026  
**Autor:** Claude AI + Equipe E-Racing  
**Status:** Documento Técnico Definitivo

---

## 📋 ÍNDICE
1. [Visão Geral da Arquitetura](#visao-geral)
2. [MACRO 1: SEEDER (Carro)](#macro-seeder)
   - [N1-CAN-CAP: CAN Capture Layer](#n1-can-cap)
   - [N2-CAN-PROC: CAN Processing Layer](#n2-can-proc)
   - [N3-TCP-TX: TCP Transmission Layer](#n3-tcp-tx)
   - [N4-WIFI-PHY: WiFi Physical Layer](#n4-wifi-phy)
3. [MACRO 2: SERVER (Base Station)](#macro-server)
   - [N5-NET-RX: Network Reception Layer](#n5-net-rx)
   - [N6-DATA-PROC: Data Processing Layer](#n6-data-proc)
   - [N7-WS-BC: WebSocket Broadcast Layer](#n7-ws-bc)
4. [MACRO 3: CLIENT (Aplicativo)](#macro-client)
   - [N8-WS-RX: WebSocket Reception Layer](#n8-ws-rx)
   - [N9-RN-PROC: React Native Processing Layer](#n9-rn-proc)
   - [N10-UI-RENDER: UI Rendering Layer](#n10-ui-render)
   - [N11-DISPLAY: Display Output Layer](#n11-display)
5. [Análise de Latências](#analise-latencias)
6. [Protocolos e Tecnologias](#protocolos-tecnologias)

---

<a name="visao-geral"></a>
## 📊 1. VISÃO GERAL DA ARQUITETURA

### **1.1 Arquitetura de 3 Macros e 11 Níveis**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TELEMETRIA V2.1 - ARQUITETURA COMPLETA               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  MACRO 1: SEEDER (Jetson AGX Xavier - Inside Car)                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  N1-CAN-CAP   : CAN Capture Layer                                │  │
│  │  N2-CAN-PROC  : CAN Processing Layer                             │  │
│  │  N3-TCP-TX    : TCP Transmission Layer                           │  │
│  │  N4-WIFI-PHY  : WiFi Physical Layer                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                             ↓ WiFi 2.4GHz                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  MACRO 2: SERVER (Base Station - Intel NUC/Xeon)                │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │  N5-NET-RX    : Network Reception Layer                          │  │
│  │  N6-DATA-PROC : Data Processing Layer                            │  │
│  │  N7-WS-BC     : WebSocket Broadcast Layer                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                             ↓ WebSocket                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  MACRO 3: CLIENT (Android App - Smartphones/Tablets)            │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │  N8-WS-RX     : WebSocket Reception Layer                        │  │
│  │  N9-RN-PROC   : React Native Processing Layer                    │  │
│  │  N10-UI-RENDER: UI Rendering Layer                               │  │
│  │  N11-DISPLAY  : Display Output Layer                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  LATÊNCIA TOTAL: 50-100ms (sensor físico → pixel na tela)              │
│  THROUGHPUT: 1000+ mensagens/segundo                                    │
│  CONFIABILIDADE: 99%+                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### **1.2 Nomenclatura e Siglas**

| Sigla | Nome Completo | Função | Tecnologia |
|-------|---------------|--------|------------|
| **N1-CAN-CAP** | CAN Capture Layer | Captura frames CAN do barramento | SocketCAN (Linux) |
| **N2-CAN-PROC** | CAN Processing Layer | Processa, parseia e serializa dados CAN | Rust (socketcan-rs) |
| **N3-TCP-TX** | TCP Transmission Layer | Transmite dados via TCP | Rust (tokio) |
| **N4-WIFI-PHY** | WiFi Physical Layer | Transmissão física de ondas de rádio | IEEE 802.11n/ac |
| **N5-NET-RX** | Network Reception Layer | Recebe dados da rede WiFi | Linux Kernel + Rust |
| **N6-DATA-PROC** | Data Processing Layer | Decodifica CAN e armazena em banco | Rust + TimescaleDB |
| **N7-WS-BC** | WebSocket Broadcast Layer | Distribui dados em tempo real via WebSocket | Rust (actix-web) |
| **N8-WS-RX** | WebSocket Reception Layer | Recebe dados via WebSocket | JavaScript (React Native) |
| **N9-RN-PROC** | React Native Processing Layer | Processa dados no app | JavaScript + React |
| **N10-UI-RENDER** | UI Rendering Layer | Renderiza interface do usuário | React Native + Android |
| **N11-DISPLAY** | Display Output Layer | Exibe pixels na tela | GPU + Display |

---

<a name="macro-seeder"></a>
## 🚗 2. MACRO 1: SEEDER (CARRO)

<a name="n1-can-cap"></a>
### **N1-CAN-CAP: CAN Capture Layer**

#### **2.1.1 Visão Geral**

Camada responsável por capturar frames CAN diretamente do barramento físico do carro.

```
SENSOR FÍSICO → ECU → CAN BUS → KERNEL DRIVER → N1-CAN-CAP
```

#### **2.1.2 Sensor Físico até ECU**

**Exemplo: Sensor de Voltagem da Bateria**

```
┌─────────────────────────────────────────────────────────┐
│  1. SENSOR DE TENSÃO (Mundo Analógico)                 │
│                                                         │
│  Bateria: 380.5 Volts DC                               │
│     ↓                                                   │
│  Divisor de Tensão (R1=100kΩ, R2=1kΩ):                │
│  Vout = 380.5V × (1kΩ / 101kΩ) = 3.77V                │
│     ↓                                                   │
│  ┌─────────────────────────────────────────┐           │
│  │  ADC (Analog-to-Digital Converter)      │           │
│  │  • Resolução: 12 bits (0-4095)          │           │
│  │  • Referência: 5V                        │           │
│  │  • Frequência: 1 kHz                     │           │
│  └─────────────────────────────────────────┘           │
│     ↓                                                   │
│  Valor Digital = (3.77V / 5V) × 4095                   │
│                = 0.754 × 4095                           │
│                = 3087 ≈ 3085 (após calibração)         │
│     ↓                                                   │
│  ECU aplica fator: 3085 / 10 = 308.5                   │
│  Armazena como: 3085 (0x0C0D em hex)                   │
└─────────────────────────────────────────────────────────┘

LATÊNCIA: 1-5ms (amostragem + conversão ADC)
```

**Conversão ADC detalhada:**

```
SINAL ANALÓGICO (Voltagem):
     5V ┤           
        │           
  3.77V ├─────●     ← Voltagem medida
        │     │     
     0V └─────┴─────→ Tempo
           ▲
        Momento da amostragem

ADC PROCESSO:
1. Sample & Hold: Captura voltagem (3.77V)
2. Comparação sucessiva (12 bits):
   
   Bit 11 (MSB): 3.77V > 2.5V?  → Sim (1)
   Bit 10:       3.77V > 3.75V? → Sim (1)
   Bit 9:        3.77V > 3.91V? → Não (0)
   ... (continua para todos os 12 bits)
   
3. Resultado binário: 1100 0000 1101
4. Valor decimal: 3085
5. Tempo de conversão: ~100 microsegundos

REPRESENTAÇÃO EM MEMÓRIA (ECU):
Endereço | Valor (Hex) | Valor (Dec)
---------|-------------|-------------
0x2000   | 0x0D        | 13 (LSB)
0x2001   | 0x0C        | 12 (MSB)

Little Endian: 0x0C0D = 3085
```

#### **2.1.3 Montagem do Frame CAN na ECU**

```
ECU PROCESSAMENTO:
┌──────────────────────────────────────────────────────────┐
│  1. Valor bruto: 3085 (0x0C0D)                           │
│                                                          │
│  2. Aplica fator de escala para transmissão (×10):      │
│     3085 → 30850 (0x7872)                               │
│     Motivo: Preservar precisão decimal                  │
│                                                          │
│  3. Converte para bytes (Little Endian):                │
│     0x7872 → [0x72, 0x78]                               │
│                                                          │
│  4. Monta frame CAN:                                    │
│     CAN ID: 0x19B50100 (Extended, 29 bits)             │
│     DLC: 8 bytes                                        │
│     DATA[0]: 0x72 (114) ← LSB                          │
│     DATA[1]: 0x78 (120) ← MSB                          │
│     DATA[2-7]: 0x00 (padding)                          │
└──────────────────────────────────────────────────────────┘

LATÊNCIA: 1-5ms (processamento ECU)
```

**Frame CAN Completo (Estrutura de Bits):**

```
CAN 2.0B EXTENDED FRAME (130 bits total):

┌──────────────────────────────────────────────────────────┐
│  SOF (Start of Frame): 1 bit                             │
│  Value: 1 (Dominant)                                     │
├──────────────────────────────────────────────────────────┤
│  IDENTIFIER (29 bits - Extended):                        │
│  0x19B50100 = 0001 1001 1011 0101 0000 0001 0000 0000  │
│                                                          │
│  Base ID (11 bits): 0x0CD (bits 28-18)                  │
│  SRR: 1 (Substitute Remote Request)                     │
│  IDE: 1 (Extended Frame)                                │
│  Extended ID (18 bits): 0x2A800 (bits 17-0)            │
├──────────────────────────────────────────────────────────┤
│  RTR: 0 (Data Frame, não Remote Request)                │
│  r1, r0: 00 (Reserved bits)                             │
├──────────────────────────────────────────────────────────┤
│  DLC (Data Length Code): 4 bits                         │
│  Value: 1000 (8 bytes)                                  │
├──────────────────────────────────────────────────────────┤
│  DATA FIELD: 64 bits (8 bytes)                          │
│  Byte 0: 01110010 (0x72 = 114)                         │
│  Byte 1: 01111000 (0x78 = 120)                         │
│  Byte 2: 00000000 (0x00 = 0)                           │
│  Byte 3: 00000000 (0x00 = 0)                           │
│  Byte 4: 00000000 (0x00 = 0)                           │
│  Byte 5: 00000000 (0x00 = 0)                           │
│  Byte 6: 00000000 (0x00 = 0)                           │
│  Byte 7: 00000000 (0x00 = 0)                           │
├──────────────────────────────────────────────────────────┤
│  CRC (Cyclic Redundancy Check): 15 bits                 │
│  Algoritmo: CRC-15-CAN                                  │
│  Polinômio: x^15 + x^14 + x^10 + x^8 + x^7 + x^4 + x^3 + 1│
│  Calculado sobre: SOF até fim do DATA                   │
├──────────────────────────────────────────────────────────┤
│  CRC Delimiter: 1 bit (Recessive)                       │
│  ACK Slot: 1 bit (Dominant quando acknowledged)         │
│  ACK Delimiter: 1 bit (Recessive)                       │
│  EOF (End of Frame): 7 bits (todos Recessive)           │
│  IFS (Inter Frame Space): 3 bits                        │
└──────────────────────────────────────────────────────────┘

TEMPO DE TRANSMISSÃO:
130 bits / 500 kbit/s = 260 microsegundos
```

#### **2.1.4 Transmissão no Barramento CAN**

```
TOPOLOGIA CAN BUS (Diferencial):

ECU Motor ──┬── ECU Bateria ──┬── ECU Display ──┬── Jetson
            │                 │                 │
         CAN_H (High) ────────────────────────────────
         CAN_L (Low)  ────────────────────────────────
            │                 │                 │
        120Ω Term         (optional)       120Ω Term
        

SINAIS ELÉTRICOS (Diferencial):

Tempo →
        ┌───┐   ┌───┐       ┌───┐
CAN_H:  │   │   │   │       │   │  3.5V (Dominant)
      ──┘   └───┘   └───────┘   └─ 2.5V (Recessive)

        ┌───┐   ┌───┐       ┌───┐
CAN_L:  │   │   │   │       │   │  1.5V (Dominant)
      ──┘   └───┘   └───────┘   └─ 2.5V (Recessive)

Diferença (CAN_H - CAN_L):
        ┌───┐   ┌───┐       ┌───┐
        │ 2V│   │ 2V│       │ 2V│ ← Dominant (bit 1)
      ──┘ 0V└───┘ 0V└───────┘ 0V└─ ← Recessive (bit 0)


VANTAGENS DO SINAL DIFERENCIAL:
✅ Imunidade a ruído (EMI):
   Ruído afeta ambos os fios igualmente
   Diferença permanece constante
   
✅ Longo alcance:
   Pode transmitir até 40 metros @ 1 Mbit/s
   Nosso caso: ~5 metros @ 500 kbit/s
   
✅ Confiabilidade:
   Detecta erros de transmissão
   CRC valida integridade
```

**Propagação do sinal no fio:**

```
VELOCIDADE DE PROPAGAÇÃO:
• Velocidade da luz no vácuo: 3×10⁸ m/s
• Velocidade em cabo (66% da luz): 2×10⁸ m/s
• Distância no carro: 5 metros
• Tempo de propagação: 5m / (2×10⁸ m/s) = 25 nanosegundos

LATÊNCIA TOTAL CAN BUS:
• Montagem do frame na ECU: 1-5 ms
• Transmissão dos bits: 0.26 ms
• Propagação no fio: 0.000025 ms (desprezível)
• TOTAL: 1-5.3 ms
```

#### **2.1.5 Driver SocketCAN (Linux Kernel)**

```
LINUX KERNEL - CAN SUBSYSTEM:

┌────────────────────────────────────────────────────────┐
│  HARDWARE LAYER                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  CAN Controller (MCP2515 ou similar)             │  │
│  │  • Conectado via SPI ao Jetson                   │  │
│  │  • Recebe bits do barramento CAN                 │  │
│  │  • Valida CRC                                    │  │
│  │  • Armazena frame em buffer interno (FIFO)      │  │
│  └──────────────────────────────────────────────────┘  │
│                     ↓ IRQ (Interrupt)                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  INTERRUPT HANDLER (Kernel Space)                │  │
│  │  1. Kernel pausa processo atual                  │  │
│  │  2. Salva contexto (registradores)               │  │
│  │  3. Executa ISR (Interrupt Service Routine)      │  │
│  │  4. Lê frame do CAN Controller via SPI           │  │
│  │  5. Copia para buffer do SocketCAN               │  │
│  │  6. Marca file descriptor como "readable"        │  │
│  │  7. Acorda processos bloqueados em read()        │  │
│  │  8. Restaura contexto                            │  │
│  │  9. Resume processo pausado                      │  │
│  └──────────────────────────────────────────────────┘  │
│                     ↓                                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  SOCKETCAN DRIVER (/drivers/net/can/)            │  │
│  │  • Implementa interface socket()                 │  │
│  │  • Buffer circular (16-32 frames típico)         │  │
│  │  • Fila FIFO (First In, First Out)              │  │
│  │  • Filtros de CAN ID (hardware/software)        │  │
│  └──────────────────────────────────────────────────┘  │
│                     ↓                                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  DEVICE FILE: /dev/can0                          │  │
│  │  • Character device                              │  │
│  │  • Suporta operações: open(), read(), write()    │  │
│  │  • Modo blocking ou non-blocking                 │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────────┐
│  USER SPACE                                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  RUST APPLICATION (N2-CAN-PROC)                  │  │
│  │  let socket = CanSocket::open("can0")?;          │  │
│  │  let frame = socket.read_frame()?;               │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘

LATÊNCIA N1-CAN-CAP:
• Interrupt latency: 10-50 µs
• ISR execution: 10-100 µs
• Context switch: 1-10 µs
• TOTAL: 0.02-0.16 ms
```

**Estrutura do frame no buffer do kernel:**

```
KERNEL MEMORY (struct can_frame):

Offset | Size | Field          | Value (Exemplo)
-------|------|----------------|------------------
0x00   | 4B   | can_id         | 0x19B50100
0x04   | 1B   | can_dlc        | 8
0x05   | 3B   | __pad          | 0x00 0x00 0x00
0x08   | 8B   | data[8]        | 72 78 00 00 00 00 00 00
-------|------|----------------|------------------
Total: 16 bytes (alinhamento de memória)

Layout na RAM (Little Endian x86_64):
0x7FFF1000: 00 01 B5 19 08 00 00 00 72 78 00 00 00 00 00 00
            └─ can_id ─┘ │  └─ pad ┘ └────── data[8] ──────┘
                        └─ dlc
```

---

<a name="n2-can-proc"></a>
### **N2-CAN-PROC: CAN Processing Layer**

#### **2.2.1 Visão Geral**

Camada Rust que lê frames CAN do kernel, processa, parseia e serializa para transmissão.

```
N1-CAN-CAP (Kernel) → read_frame() → Parsing → Conversão → Serialização
```

#### **2.2.2 Leitura do Frame (Rust)**

```rust
// Código Rust simplificado
use socketcan::{CanSocket, Socket};

fn read_can_frame() -> Result<ProcessedFrame> {
    // 1. Open socket (já aberto, mantém handle)
    let socket: CanSocket = /* ... */;
    
    // 2. Read frame (bloqueante ou non-blocking)
    let frame = socket.read_frame()?;
    
    // O que acontece internalmente:
    // ┌────────────────────────────────────────┐
    // │ socket.read_frame() faz:               │
    // │  1. Syscall read() → kernel space      │
    // │  2. Kernel verifica buffer SocketCAN   │
    // │  3. Se vazio: bloqueia thread          │
    // │  4. Se cheio: copia 16 bytes para user │
    // │  5. Retorna struct CanFrame            │
    // └────────────────────────────────────────┘
    
    // 3. Frame em memória user space
    // frame = CanFrame {
    //     id: 0x19B50100,
    //     data: [0x72, 0x78, 0x00, ...],
    //     len: 8
    // }
    
    Ok(frame)
}

LATÊNCIA: 0.01-0.1 ms (syscall + copy)
```

**Transição Kernel → User Space:**

```
ANTES (Kernel Space):
┌──────────────────────────────────────┐
│ Kernel Memory: 0xFFFF8800...         │
│ struct can_frame frame;              │
│ frame.can_id = 0x19B50100;          │
│ frame.data[0] = 0x72;               │
│ frame.data[1] = 0x78;               │
└──────────────────────────────────────┘

SYSCALL read():
┌──────────────────────────────────────┐
│ 1. User process faz read()           │
│ 2. CPU switch para kernel mode       │
│ 3. Kernel valida permissões          │
│ 4. copy_to_user() copia 16 bytes     │
│ 5. CPU switch para user mode         │
└──────────────────────────────────────┘

DEPOIS (User Space):
┌──────────────────────────────────────┐
│ User Memory: 0x00007F...             │
│ struct CanFrame {                    │
│   id: 0x19B50100,                   │
│   data: [0x72, 0x78, 0x00, ...],   │
│   len: 8                            │
│ }                                    │
└──────────────────────────────────────┘

CUSTO:
• Context switch: ~1-5 µs
• Memory copy (16 bytes): ~0.01 µs
• Validações e overhead: ~5-10 µs
• TOTAL: ~6-15 µs
```

#### **2.2.3 Parsing e Conversão**

```rust
fn process_frame(frame: CanFrame) -> TelemetryData {
    // 1. Extrair CAN ID
    let can_id: u32 = match frame.id() {
        socketcan::Id::Standard(id) => id.as_raw() as u32,
        socketcan::Id::Extended(id) => id.as_raw(),
    };
    // can_id = 0x19B50100
    
    // 2. Extrair dados
    let data = frame.data();
    // data = &[0x72, 0x78, 0x00, 0x00, ...]
    
    // 3. Converter bytes para valor (Little Endian)
    let raw_value: u16 = ((data[1] as u16) << 8) | (data[0] as u16);
    // Operação bit a bit:
    // data[1] = 0x78 = 01111000
    // (0x78 << 8) = 0x7800 = 0111100000000000
    // 
    // data[0] = 0x72 = 01110010
    // 
    // 0111100000000000 (0x7800)
    // OR
    // 0000000001110010 (0x0072)
    // ────────────────
    // 0111100001110010 (0x7872 = 30850)
    
    // 4. Aplicar fator de escala
    let voltage = (raw_value as f64) / 10.0;
    // voltage = 30850.0 / 10.0 = 3085.0
    
    // 5. Timestamp
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_secs_f64();
    // timestamp = 1708041600.123456789
    
    // 6. Criar estrutura
    TelemetryData {
        timestamp,
        can_id,
        signal_name: "battery_voltage".to_string(),
        value: voltage,
        unit: "V".to_string(),
    }
}

LATÊNCIA: 0.001-0.01 ms (parsing puro, muito rápido)
```

**Operações de Bit Shift Visualizadas:**

```
SHIFT LEFT (<<):
Original:  01111000 (0x78 = 120)
<< 8:      0111100000000000 (0x7800 = 30720)

OR Operation:
  0111100000000000 (0x7800)
| 0000000001110010 (0x0072)
──────────────────
  0111100001110010 (0x7872 = 30850)

CONVERSÃO PARA f64:
raw_value: u16 = 30850
           ↓ as f64
value_f64: f64 = 30850.0
           ↓ / 10.0
voltage:   f64 = 3085.0

IEEE 754 Double (64 bits):
Sign: 0 (positivo)
Exponent: 10000001010 (1034 - 1023 = 11)
Mantissa: 1.00010001... (fração binária)

Binário: 0 10000001010 0001000100100000000000000000000000000000000000000000
Hex:     0x40A8120000000000
```

#### **2.2.4 Serialização para Transmissão**

```rust
fn serialize_for_transmission(data: &TelemetryData) -> Vec<u8> {
    let mut payload = Vec::with_capacity(20);
    
    // Layout do payload (20 bytes):
    // [0-3]:   CAN ID (u32, Little Endian)
    // [4-11]:  Timestamp (f64, IEEE 754)
    // [12-19]: Data CAN (8 bytes)
    
    // 1. CAN ID (4 bytes)
    payload.extend_from_slice(&data.can_id.to_le_bytes());
    // 0x19B50100 → [0x00, 0x01, 0xB5, 0x19]
    
    // 2. Timestamp (8 bytes)
    payload.extend_from_slice(&data.timestamp.to_le_bytes());
    // 1708041600.123456789 → [0x85, 0xEB, 0x51, 0xB8, 0x1E, 0x50, 0xE5, 0x41]
    
    // 3. Data CAN (8 bytes)
    let mut data_fixed = [0u8; 8];
    data_fixed[0] = 0x72;
    data_fixed[1] = 0x78;
    // data_fixed[2..7] = 0x00 (padding)
    payload.extend_from_slice(&data_fixed);
    
    payload
}

RESULTADO (20 bytes):
[00 01 B5 19 85 EB 51 B8 1E 50 E5 41 72 78 00 00 00 00 00 00]
 └─ CAN ID ┘ └───── Timestamp ──────┘ └───── Data CAN ─────┘

LATÊNCIA: 0.01-0.1 ms (alocação + cópias de memória)
```

---

<a name="n3-tcp-tx"></a>
### **N3-TCP-TX: TCP Transmission Layer**

#### **2.3.1 Por que TCP em vez de MQTT?**

```
COMPARAÇÃO: TCP RAW vs MQTT

TCP RAW (escolhido):
✅ Menor overhead (20 bytes header)
✅ Latência mais baixa (sem broker intermediário)
✅ Controle total do protocolo
✅ Mais simples para debug
✅ Conexão direta Jetson → Servidor
✅ Ideal para rede local (baixa latência)

MQTT (alternativa):
✅ Padrão da indústria IoT
✅ QoS (Quality of Service) embutido
✅ Publish/Subscribe pattern
✅ Broker gerencia múltiplos clientes
❌ Overhead adicional (MQTT header ~10-30 bytes)
❌ Latência extra (Jetson → Broker → Servidor)
❌ Complexidade desnecessária para rede local
❌ Broker = single point of failure

DECISÃO: TCP RAW
• Rede local sem internet = TCP direto é melhor
• Latência crítica = eliminar intermediários
• Overhead importa = cada byte conta
• Controle total = debug facilitado

Se fosse internet/WAN → MQTT seria melhor
Se fossem muitos carros → MQTT faz sentido
```

**Comparação de overhead:**

```
MQTT OVER TCP:
┌─────────────────────────────────────────┐
│ Dados úteis: 20 bytes                   │
├─────────────────────────────────────────┤
│ MQTT Fixed Header: 2-5 bytes            │
│ MQTT Variable Header: 0-10 bytes        │
│ TCP Header: 20 bytes                    │
│ IP Header: 20 bytes                     │
│ Ethernet: 14 bytes + 4 bytes FCS        │
├─────────────────────────────────────────┤
│ TOTAL: 80-93 bytes                      │
│ Overhead: 300-365%                      │
└─────────────────────────────────────────┘

TCP RAW:
┌─────────────────────────────────────────┐
│ Dados úteis: 24 bytes (len + payload)   │
├─────────────────────────────────────────┤
│ TCP Header: 20 bytes                    │
│ IP Header: 20 bytes                     │
│ Ethernet: 14 bytes + 4 bytes FCS        │
├─────────────────────────────────────────┤
│ TOTAL: 82 bytes                         │
│ Overhead: 241%                          │
└─────────────────────────────────────────┘

GANHO TCP RAW: ~10% menos overhead
```

#### **2.3.2 Código Rust - Envio TCP**

```rust
use tokio::net::TcpStream;
use tokio::io::AsyncWriteExt;

async fn send_tcp(stream: &mut TcpStream, payload: &[u8]) -> Result<()> {
    // 1. Enviar tamanho do payload (4 bytes)
    let len = payload.len() as u32;  // 20
    stream.write_all(&len.to_le_bytes()).await?;
    // Envia: [0x14, 0x00, 0x00, 0x00]
    
    // 2. Enviar payload (20 bytes)
    stream.write_all(payload).await?;
    // Envia: [0x00, 0x01, 0xB5, 0x19, ...]
    
    // 3. Flush (força envio imediato)
    stream.flush().await?;
    
    Ok(())
}

O QUE ACONTECE INTERNAMENTE:
┌────────────────────────────────────────────────────┐
│ 1. write_all() copia dados para buffer de socket  │
│    Buffer TCP: [len (4B)] [payload (20B)]         │
│                                                    │
│ 2. flush() força envio imediato                   │
│    Senão: TCP poderia esperar por mais dados      │
│    (Algoritmo de Nagle)                           │
│                                                    │
│ 3. Kernel TCP stack processa:                     │
│    • Quebra em segmentos se necessário            │
│    • Adiciona TCP header (20 bytes)               │
│    • Calcula checksum TCP                         │
│    • Passa para camada IP                         │
└────────────────────────────────────────────────────┘

LATÊNCIA: 0.1-0.5 ms (syscall + buffer copy)
```

**TCP Header Detalhado:**

```
TCP HEADER (20 bytes mínimo):

 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
┌───────────────────────────────────────────────────────────────┐
│          Source Port          │       Destination Port        │
├───────────────────────────────────────────────────────────────┤
│                        Sequence Number                        │
├───────────────────────────────────────────────────────────────┤
│                    Acknowledgment Number                      │
├─────┬─────┬─┬─┬─┬─┬─┬─┬─┬─┬───────────────────────────────────┤
│HL   │Rsvd │N│C│E│U│A│P│R│S│F│          Window Size            │
│     │     │S│W│C│R│C│S│S│Y│I│                                 │
│     │     │ │R│E│G│K│H│T│N│N│                                 │
├───────────────────────────────────────────────────────────────┤
│           Checksum            │         Urgent Pointer        │
└───────────────────────────────────────────────────────────────┘

EXEMPLO (nossa transmissão):
Source Port: 54321 (porta efêmera do Jetson)
Dest Port: 8080 (porta do servidor)
Sequence Number: 1000 (exemplo)
Acknowledgment Number: 500 (ACK do servidor)
Flags: PSH, ACK (envio imediato + acknowledge)
Window Size: 65535 (buffer disponível)
Checksum: 0xABCD (calculado)

FLAGS:
• PSH (Push): envia dados imediatamente para aplicação
• ACK (Acknowledgment): confirma recebimento
• SYN (Synchronize): inicia conexão
• FIN (Finish): termina conexão
```

#### **2.3.3 TCP Three-Way Handshake (Conexão Inicial)**

```
ESTABELECIMENTO DE CONEXÃO TCP:

Jetson (Client)                    Servidor (Server)
192.168.1.20:54321                 192.168.1.100:8080
     │                                    │
     │ SYN (seq=100)                     │
     ├───────────────────────────────────>│
     │                                    │ Estado: LISTEN
     │                                    │ → SYN_RCVD
     │                                    │
     │          SYN-ACK (seq=300, ack=101)│
     │<───────────────────────────────────┤
     │                                    │
     │ ACK (seq=101, ack=301)            │
     ├───────────────────────────────────>│
     │                                    │ Estado: ESTABLISHED
     │                                    │
     │    Conexão estabelecida! ✅        │
     │                                    │

TEMPO TOTAL: ~3-10 ms (rede local)

RTT (Round-Trip Time):
• Jetson → Servidor: ~1-3 ms
• Servidor → Jetson: ~1-3 ms
• RTT total: ~2-6 ms
• 3-way handshake: 1.5 × RTT = 3-9 ms
```

#### **2.3.4 Transmissão de Dados**

```
ENVIO DE 24 BYTES (len + payload):

Jetson                              Servidor
  │                                    │
  │ PSH, ACK                          │
  │ seq=101, ack=301                  │
  │ data=[len(4B) + payload(20B)]     │
  ├───────────────────────────────────>│
  │                                    │
  │                     ACK            │
  │              seq=301, ack=125      │
  │<───────────────────────────────────┤
  │                                    │

DETALHES DO SEGMENTO TCP:
┌─────────────────────────────────────────┐
│ TCP Header: 20 bytes                    │
│   • Source Port: 54321                  │
│   • Dest Port: 8080                     │
│   • Seq: 101                            │
│   • Ack: 301                            │
│   • Flags: PSH, ACK                     │
│   • Window: 65535                       │
│   • Checksum: (calculado)               │
├─────────────────────────────────────────┤
│ TCP Data: 24 bytes                      │
│   [14 00 00 00] ← len = 20             │
│   [00 01 B5 19 ... 72 78 00 00 ...]    │
└─────────────────────────────────────────┘

LATÊNCIA TCP:
• Serialização: 0.01-0.1 ms
• Syscall write: 0.01-0.05 ms
• TCP/IP stack: 0.1-0.5 ms
• TOTAL: 0.12-0.65 ms
```

---

<a name="n4-wifi-phy"></a>
### **N4-WIFI-PHY: WiFi Physical Layer**

#### **2.4.1 Visão Geral**

Camada que transmite bits digitais como ondas eletromagnéticas pelo ar.

```
DIGITAL (bytes) → MODULAÇÃO → ANALÓGICO (ondas) → AR → RECEPÇÃO
```

#### **2.4.2 Stack de Rede (Camadas OSI)**

```
PACOTE COMPLETO (82 bytes):

┌─────────────────────────────────────────────────────┐
│ CAMADA 7: APPLICATION                               │
│   Dados: 24 bytes (len + payload)                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ CAMADA 4: TRANSPORT (TCP)                           │
│   Header: 20 bytes                                  │
│   Data: 24 bytes                                    │
│   Total: 44 bytes                                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ CAMADA 3: NETWORK (IP)                              │
│   Header: 20 bytes                                  │
│     • Version: IPv4 (4)                             │
│     • Header Length: 5 (×4 = 20 bytes)              │
│     • Total Length: 64 bytes                        │
│     • Protocol: TCP (6)                             │
│     • Source IP: 192.168.1.20                       │
│     • Dest IP: 192.168.1.100                        │
│     • TTL: 64                                       │
│     • Checksum: (calculado)                         │
│   Data: 44 bytes (TCP segment)                      │
│   Total: 64 bytes                                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ CAMADA 2: DATA LINK (Ethernet sobre WiFi)           │
│   Header: 14 bytes                                  │
│     • Dest MAC: AA:BB:CC:DD:EE:FF (servidor)        │
│     • Source MAC: 11:22:33:44:55:66 (Jetson)        │
│     • EtherType: 0x0800 (IPv4)                      │
│   Data: 64 bytes (IP packet)                        │
│   FCS (Frame Check Sequence): 4 bytes               │
│   Total: 82 bytes                                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ CAMADA 1: PHYSICAL (WiFi 2.4 GHz)                   │
│   802.11 MAC Header: ~34 bytes                      │
│   Data: 82 bytes (Ethernet frame)                   │
│   FCS: 4 bytes                                      │
│   Total: 120 bytes                                  │
│                                                     │
│   Bits totais: 960 bits                            │
│   Taxa: 54 Mbps (802.11g)                          │
│   Tempo transmissão: 960 / 54×10⁶ ≈ 18 µs          │
└─────────────────────────────────────────────────────┘
```

**Overhead visualizado:**

```
DADOS ÚTEIS vs OVERHEAD:

Dados úteis: 24 bytes (100%)
├─ TCP header: +20 bytes (+83%)
├─ IP header: +20 bytes (+83%)
├─ Ethernet: +18 bytes (+75%)
├─ 802.11 MAC: +34 bytes (+141%)
└─ TOTAL: 116 bytes (483% overhead!)

Gráfico:
┌────────────────────────────────────────┐
│████ 24B  Dados úteis                   │
│████████ 20B  TCP                       │
│████████ 20B  IP                        │
│███████ 18B  Ethernet                   │
│█████████████ 34B  WiFi 802.11          │
└────────────────────────────────────────┘
 0    20   40   60   80  100  120 bytes

POR ISSO BATCHING É IMPORTANTE!
• Enviar 10 frames juntos: 240B dados + 116B overhead = 353%
• Enviar 1 frame: 24B dados + 116B overhead = 483%
• GANHO: 30% menos overhead com batching!
```

#### **2.4.3 Modulação OFDM (802.11g/n)**

```
OFDM: Orthogonal Frequency-Division Multiplexing

CONCEITO:
• Divide canal em múltiplas sub-portadoras
• Cada sub-portadora carrega parte dos dados
• 802.11g: 52 sub-portadoras (48 dados + 4 piloto)
• Espaçamento: 312.5 kHz

ESPECTRO 2.4 GHz:
        Canal 6: 2.437 GHz
        ↓
    ┌───────────────────────┐
    │ │││││││││││││││││││││ │ ← 52 sub-portadoras
    └───────────────────────┘
    2.412       2.437      2.462 GHz
    
Largura de banda: 20 MHz

SUB-PORTADORAS:
Frequência central: 2.437 GHz
Sub 1: 2.437000 GHz - 10 MHz + 0 × 312.5 kHz
Sub 2: 2.437000 GHz - 10 MHz + 1 × 312.5 kHz
...
Sub 52: 2.437000 GHz - 10 MHz + 51 × 312.5 kHz
```

**Modulação digital:**

```
CONVERSÃO DIGITAL → ANALÓGICO:

BITS DIGITAIS:
1 0 1 1 0 0 1 0 ...

↓ MAPPING (64-QAM para 802.11g)

SÍMBOLOS QAM:
Cada símbolo = 6 bits
┌─────────────────────────────────┐
│ Constelação 64-QAM              │
│                                 │
│   ●   ●   ●   ●   ●   ●   ●   ● │
│   ●   ●   ●   ●   ●   ●   ●   ● │
│   ●   ●   ●   ●   ●   ●   ●   ● │
│   ●   ●   ●   ●   ●   ●   ●   ● │
│                                 │
│ I (In-phase) →                  │
│             ↑                   │
│             Q (Quadrature)      │
└─────────────────────────────────┘

64 posições = 6 bits/símbolo
Exemplo: bits [1 0 1 1 0 0] → posição (3, 5)

↓ MODULAÇÃO

SINAL ANALÓGICO:
Amplitude e fase variam conforme símbolo
        
        ┌─┐  ┌┐
     ┌──┘ └──┘└──┐
  ───┘          └───
     ↑ ↑ ↑ ↑ ↑ ↑
     Símbolos QAM modulados na portadora
```

**IFFT (Inverse Fast Fourier Transform):**

```
PROCESSO OFDM COMPLETO:

1. BITS DE ENTRADA (960 bits):
   [1 0 1 1 0 0 1 0 1 1 ...]
   
2. MAPPING PARA QAM (960 bits / 6 = 160 símbolos):
   [Symbol1, Symbol2, Symbol3, ...]
   
3. SERIAL-TO-PARALLEL:
   Distribui símbolos nas 48 sub-portadoras
   Sub 1: [Sym1, Sym49, Sym97, ...]
   Sub 2: [Sym2, Sym50, Sym98, ...]
   ...
   Sub 48: [Sym48, Sym96, ...]
   
4. IFFT (Inverse FFT):
   Cada símbolo → componente de frequência
   IFFT combina todas em sinal tempo
   
   FREQUÊNCIA → TEMPO
   ──────────────────
   F1: ●─────────────   ┐
   F2: ──●───────────   │
   F3: ────●─────────   │ IFFT → ∿∿∿∿∿∿∿∿
   ...                  │        Sinal
   F48: ────────────●   ┘        tempo
   
5. CYCLIC PREFIX:
   Copia final do símbolo para o início
   Previne interferência entre símbolos
   
6. CONVERSÃO DAC (Digital-Analog):
   Bits digitais → voltagem analógica
   
7. UPCONVERSION:
   Sinal de banda base → 2.437 GHz
   Mixer multiplica por portadora RF
   
8. AMPLIFICAÇÃO:
   Power Amplifier (PA)
   Entrada: ~1 mW
   Saída: 100 mW (20 dBm)
   
9. ANTENA:
   Corrente oscilante (2.437 GHz)
   → Campo eletromagnético
   → Ondas de rádio propagam
```

#### **2.4.4 Propagação de Ondas Eletromagnéticas**

```
CARACTERÍSTICAS DA ONDA:

Frequência: f = 2.437 GHz = 2.437 × 10⁹ Hz
Velocidade da luz: c = 3 × 10⁸ m/s
Comprimento de onda: λ = c / f
                      λ = (3 × 10⁸) / (2.437 × 10⁹)
                      λ = 0.123 metros = 12.3 cm

FORMA DA ONDA:
        ╭─╮     ╭─╮     ╭─╮
        │ │     │ │     │ │
  ──────╯ ╰─────╯ ╰─────╯ ╰───── Tempo →
  ◄──12.3cm──►
  
  Um comprimento de onda = 12.3 cm
  Em 1 segundo: 2.437 bilhões de oscilações

CAMPO ELETROMAGNÉTICO:
        
  E (Campo Elétrico)
  ↑
  │   ╱╲      ╱╲
  │  ╱  ╲    ╱  ╲
  ├─────╲──╱────╲──╱─→ Propagação
  │      ╲╱      ╲╱
  │
  
      ↓↑
  B (Campo Magnético)
  Perpendicular ao elétrico
```

**Path Loss (Perda de Propagação):**

```
FREE SPACE PATH LOSS (FSPL):

FSPL(dB) = 20×log₁₀(d) + 20×log₁₀(f) + 32.44
Onde:
  d = distância em km
  f = frequência em MHz

Exemplo (10 metros = 0.01 km):
FSPL = 20×log₁₀(0.01) + 20×log₁₀(2437) + 32.44
     = 20×(-2) + 20×(3.387) + 32.44
     = -40 + 67.74 + 32.44
     = 60.18 dB

INTERPRETAÇÃO:
Potência transmitida: 100 mW (20 dBm)
Perda: 60 dB
Potência recebida: 20 dBm - 60 dB = -40 dBm
                 = 0.0001 mW = 0.1 µW

AINDA É MUITO FORTE!
• Sensibilidade do receptor: -96 dBm típico
• Margem: -40 - (-96) = 56 dB
• Conexão excelente! ✅
```

**Velocidade de propagação:**

```
TEMPO DE PROPAGAÇÃO:

Distância Jetson → Servidor: 10 metros
Velocidade da luz: 3 × 10⁸ m/s

Tempo = Distância / Velocidade
      = 10 m / (3 × 10⁸ m/s)
      = 3.33 × 10⁻⁸ segundos
      = 33.3 nanosegundos

DESPREZÍVEL! 
(muito menor que outras latências)

COMPARAÇÃO:
• Propagação WiFi: 0.000033 ms
• Modulação OFDM: 0.018 ms
• TCP/IP stack: 0.5 ms
• Processamento: 1-10 ms
```

#### **2.4.5 Latência Total N4-WIFI-PHY**

```
BREAKDOWN DETALHADO:

1. IP Routing (kernel): 0.01-0.05 ms
2. Ethernet encapsulation: 0.01 ms
3. 802.11 MAC processing: 0.05-0.2 ms
4. OFDM modulation: 0.01-0.05 ms
5. Transmissão física: 0.018 ms
6. Propagação no ar: 0.000033 ms
7. Contention (CSMA/CA): 0-1 ms (variável)
8. ACK 802.11: 0.05-0.1 ms

TOTAL: 0.16-1.5 ms (típico: 0.3-0.8 ms)

VARIABILIDADE:
• Melhor caso (canal livre): 0.16 ms
• Caso típico (uso normal): 0.5 ms
• Pior caso (interferência): 1-2 ms
```

---

Essa é a primeira parte do documento! Devido ao tamanho, vou continuar com as outras macros em seguida.

**CONTINUA...**

Este documento está ficando muito extenso. Devo continuar com:
- MACRO 2: SERVER (N5, N6, N7)
- MACRO 3: CLIENT (N8, N9, N10, N11)
- Análise de latências
- Protocolos e tecnologias

Ou você prefere que eu responda suas 5 perguntas primeiro antes de continuar o documento?

