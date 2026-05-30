# GUIA DE EXECUÇÃO — TELEMETRIA V2 E-RACING ULTRA BLASTER
**Versão:** 2.1  
**Data:** 01 de Março de 2026

---

## TOPOLOGIA DE REDE REAL

```
[SERVIDOR]                                              [CARRO]
Ubuntu Server                                          Jetson AGX
192.168.1.100                                          192.168.1.101
      |                                                      |
      | Cabo Ethernet                                        | Cabo Ethernet
      |                                                      |
   [ROTEADOR]                                        [Antena Unifi AC Mesh]
      |                                               (Station — no carro)
      |                                                      |
   [Antena Unifi AC Mesh]                                    ~
   (Access Point — na base)                          Wi-Fi 5GHz
      |                                                      ~
      +~~~~~~~~~~~~~~~~~~~ Wi-Fi 5GHz ~~~~~~~~~~~~~~~~~~~~~~+
```

**Fluxo dos dados:**
```
CAN Bus (carro)
    ↓ SocketCAN / Kvaser SDK
telemetry-edge (Jetson)
    ↓ TCP binário porta 8080
Antena Unifi (carro) ──Wi-Fi──→ Antena Unifi (base)
    ↓
Roteador
    ↓ Cabo
telemetry-server (Ubuntu)
    ├──→ TimescaleDB (PostgreSQL) — tempo real, últimos 7 dias
    ├──→ SQLite — histórico completo persistente
    └──→ WebSocket porta 8081 → App Android
```

---

## VELOCIDADE DA REDE: ANÁLISE E OTIMIZAÇÕES

### Como está hoje (só telemetria)

| Caminho | Tecnologia | Latência típica | Banda usada |
|---|---|---|---|
| CAN Bus → Jetson | SocketCAN | < 1ms | ~2 Mbit/s |
| Jetson → Antena Unifi | Cabo Cat5/6 | < 0.1ms | desprezível |
| Antena → Antena (Wi-Fi 5GHz) | 802.11ac | 2–5ms | ~0.2 Mbit/s |
| Antena base → Roteador | Cabo | < 0.1ms | desprezível |
| Roteador → Servidor | Cabo | < 0.1ms | desprezível |
| **TOTAL ponta-a-ponta** | | **~3–8ms** | **~0.2 Mbit/s** |

Vocês estão usando **menos de 0.2% da banda disponível** (100 Mbit/s no cabo, 300+ Mbit/s no Wi-Fi 5GHz AC).

### Quando adicionar vídeo e áudio

| Protocolo | Porta | Banda | Latência alvo |
|---|---|---|---|
| Telemetria TCP | 8080 | 0.2 Mbit/s | < 10ms |
| Áudio WebRTC | 5004 | 0.1 Mbit/s | < 50ms |
| Vídeo RTSP 1080p | 8554 | 4–8 Mbit/s | < 500ms |
| **Total** | | **~8.5 Mbit/s** | |
| **Disponível (Wi-Fi 5GHz)** | | **~150 Mbit/s** | |
| **Margem** | | **>94%** | |

Mesmo com tudo junto, vocês ficam muito abaixo do limite. **A rede não é o gargalo.**

### Pontos de melhoria possíveis

**1. Unifi em modo bridge dedicado (mais simples e rápido)**

O ideal é configurar as duas antenas Unifi em modo **PtP (Point-to-Point bridge)** em vez de Access Point + Station. No modo bridge, as antenas funcionam como um cabo virtual transparente — o roteador não precisa processar o Wi-Fi, apenas roteia o cabo.

```
[SERVIDOR] ─cabo─ [ROTEADOR] ─cabo─ [Unifi Base] ~5GHz~ [Unifi Carro] ─cabo─ [JETSON]
                                      ^                        ^
                              modo: Bridge PT              modo: Bridge PT
```

Isso reduz latência de ~5ms para ~2ms no trecho Wi-Fi.

**2. Eliminar o roteador (mais avançado)**

Se o servidor tiver duas interfaces de rede (uma para internet, outra dedicada ao carro), é possível conectar o cabo diretamente do servidor até a antena Unifi, eliminando um salto:

```
[SERVIDOR]
  ├─ enp1s0 ─→ rede da equipe (internet)
  └─ enp2s0 ─→ [Unifi Base] ~~ [Unifi Carro] ─→ [JETSON]
               192.168.2.1       192.168.2.101
```

Isso dá controle total da rede de telemetria no servidor (QoS, firewall, priorização), sem depender do roteador.

**3. QoS para quando tiver vídeo + áudio**

Quando os três protocolos estiverem ativos, configure prioridade no servidor:

```bash
# Instalar ferramentas
sudo apt install -y iproute2

# Prioridade por porta:
# Telemetria (8080) → prioridade máxima
# Áudio (5004)      → prioridade alta
# Vídeo (8554)      → prioridade normal

sudo tc qdisc add dev enp1s0 root handle 1: prio bands 3

sudo tc filter add dev enp1s0 parent 1: protocol ip prio 1 \
    u32 match ip dport 8080 0xffff flowid 1:1

sudo tc filter add dev enp1s0 parent 1: protocol ip prio 2 \
    u32 match ip dport 5004 0xffff flowid 1:2

sudo tc filter add dev enp1s0 parent 1: protocol ip prio 3 \
    u32 match ip dport 8554 0xffff flowid 1:3
```

---

## PARTE 1 — EXECUTAR O SERVIDOR

### 1.1 Verificar PostgreSQL e TimescaleDB

```bash
sudo systemctl status postgresql
# Deve estar: active (running)

psql -U eracing -d telemetria -h localhost -c "SELECT version();"
# Deve responder com a versão
```

### 1.2 Verificar IP fixo

```bash
ip addr show
# Deve mostrar 192.168.1.100 na interface ethernet
```

### 1.3 Rodar o servidor

**Em primeiro plano (desenvolvimento/debug):**
```bash
cd ~/telemetry-server
./target/release/telemetry-server
```

**Em background (produção/corrida):**
```bash
cd ~/telemetry-server
nohup ./target/release/telemetry-server > server.log 2>&1 &
echo $! > server.pid
echo "Servidor rodando — PID: $(cat server.pid)"
```

Saída esperada:
```
🚀 Telemetry Server v2.0 — Dual DB Edition
   TimescaleDB → tempo real | SQLite → histórico
✅ 47 CAN IDs carregados do CSV
✅ TimescaleDB inicializado
✅ SQLite inicializado
📡 TCP listener em 0.0.0.0:8080
🌐 WebSocket em 0.0.0.0:8081
✅ Servidor pronto!
```

### 1.4 Verificar portas abertas

```bash
sudo ss -tulpn | grep -E '8080|8081'
# Deve aparecer:
# tcp  LISTEN  0.0.0.0:8080  (TCP — frames CAN dos carros)
# tcp  LISTEN  0.0.0.0:8081  (WebSocket — app Android)
```

---

## PARTE 2 — EXECUTAR O EDGE (JETSON NO CARRO)

### 2.1 Verificar conectividade com o servidor

```bash
# No Jetson
ping 192.168.1.100
nc -zv 192.168.1.100 8080
# Deve mostrar: Connection succeeded!
```

### 2.2 Verificar interface CAN

```bash
ip link show can0
# Deve mostrar UP

# Se não estiver UP:
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0

# Testar dados chegando
candump can0
# Deve mostrar frames como:
# can0  19B50100  [8]  FF 12 34 56 78 9A BC DE
```

## PARTE 2.3 — CONFIGURAÇÃO DO CARRO (EDGE)

### 2.1 Instalar Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### 2.2 Instalar dependências

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev sqlite3 can-utils
```

### 2.3 Montar a estrutura de pastas

```bash
mkdir -p ~/telemetry-edge/src
mkdir -p ~/telemetry-edge/csv_data
cd ~/telemetry-edge
```

Estrutura esperada:

```
~/telemetry-edge/
├── Cargo.toml               ← Cargo.toml do edge
├── csv_data/
│   └── CAN Description 2025 - VCU.csv   ← mesmo CSV do servidor
└── src/
    └── main.rs              ← main.rs do edge (SocketCAN + Kvaser)
```

### 2.4 Cargo.toml do edge

Crie o arquivo `~/telemetry-edge/Cargo.toml`:

```toml
[package]
name = "telemetry-edge"
version = "2.0.0"
edition = "2021"

[features]
default = []
kvaser = ["dep:canlib"]   # habilite só se tiver o SDK Kvaser instalado

[dependencies]
tokio = { version = "1", features = ["full"] }
clap = { version = "4", features = ["derive"] }
socketcan = "3"
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio-native-tls"] }
csv = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["fmt"] }
canlib = { version = "0.3", optional = true }

[profile.release]
opt-level = 3
lto = true
```

### 2.5 Compilar o edge

**Somente SocketCAN (sem Kvaser físico):**

```bash
cd ~/telemetry-edge
cargo build --release
```

**Com Kvaser físico habilitado** (requer SDK instalado, veja seção 2.9):

```bash
cargo build --release --features kvaser
```

### 2.6 Configurar a interface CAN

Execute uma vez para subir a interface (necessário após cada reinicialização):

```bash
# Verificar se a interface existe
ip link show

# Subir a interface CAN com bitrate correto
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0

# Verificar se está UP
ip link show can0
# Deve aparecer: can0: <NOARP,UP,LOWER_UP>
```

**Para subir automaticamente no boot**, crie o arquivo:

```bash
sudo nano /etc/network/interfaces.d/can0
```

Conteúdo:

```
auto can0
iface can0 inet manual
    pre-up ip link set can0 type can bitrate 500000
    up ip link set up can0
    down ip link set down can0
```

### 2.7 Testar se o CAN está recebendo dados

Abra um segundo terminal e monitore o barramento:

```bash
candump can0
```

Saída esperada (com dados reais do carro):

```
can0  19B50100   [8]  FF 12 34 56 78 9A BC DE
can0  19B50200   [8]  A1 B2 C3 D4 E5 F6 07 08
```

Se aparecer frames, o barramento CAN está ativo e funcionando.

### 2.8 Verificar conectividade com o servidor

```bash
# Testar alcance de rede
ping 192.168.1.100

# Testar se a porta 8080 está aberta e o servidor rodando
nc -zv 192.168.1.100 8080
# Saída esperada: Connection to 192.168.1.100 8080 port [tcp/*] succeeded!
```

### 2.9 (Opcional) Instalar SDK Kvaser

Necessário apenas se usar o hardware Kvaser físico:

```bash
# Baixe o pacote em: https://www.kvaser.com/download/
# Escolha: Linux Driver and SDK

# Instalar
sudo dpkg -i kvaser-drivers-dkms_*.deb
sudo modprobe kvaser_usb

# Verificar se o device foi reconhecido
ls /dev/kvaser*
```

### 2.3.5 Rodar o edge

**Só SocketCAN (sem Kvaser físico):**
```bash
cd ~/telemetry-edge
./target/release/telemetry-edge \
    --pasta_csv ./csv_data \
    --ch0 can0 \
    --server 192.168.1.100:8080 \
    --device_id car_001
```

**SocketCAN + Kvaser:**
```bash
./target/release/telemetry-edge \
    --pasta_csv ./csv_data \
    --ch0 can0 \
    --ch1 0 \
    --bitrate0 500000 \
    --bitrate1 250000 \
    --server 192.168.1.100:8080 \
    --device_id car_001
```

Saída esperada:
```
══════════════════════════════════════════
  Telemetria Edge — SocketCAN + Kvaser
  Servidor: 192.168.1.100:8080
  Dispositivo: car_001
══════════════════════════════════════════

✅ Mapa CAN: 47 IDs (prioridade 1)
✅ SocketCAN 'can0' aberto
🔌 Conectando a 192.168.1.100:8080...
✅ Conectado!
📊 Enviados: 1000 | ID=0x19B50100 Prio=1 Canal=can0
```

---

## PARTE 3 — VERIFICAR DADOS NOS DOIS BANCOS

### 3.1 TimescaleDB — tempo real

```bash
# Últimos 20 registros
psql -U eracing -d telemetria -h localhost -c "
SELECT
    to_char(time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS.MS') as hora,
    signal_name,
    round(value::numeric, 2) as valor,
    unit,
    device_id
FROM sensor_data
ORDER BY time DESC
LIMIT 20;"
```

```bash
# Monitorar contador em tempo real
watch -n 1 "psql -U eracing -d telemetria -h localhost -t -c \
    'SELECT COUNT(*) as total, MAX(time) as ultimo FROM sensor_data;'"
```

### 3.2 SQLite — histórico

```bash
# Últimos 20 registros
sqlite3 ~/telemetry-server/data/historico.db \
  "SELECT datetime(timestamp,'unixepoch','localtime') as hora,
          signal_name,
          printf('%.2f', value) as valor,
          unit
   FROM historico
   ORDER BY id DESC
   LIMIT 20;"
```

```bash
# Total de registros históricos
sqlite3 ~/telemetry-server/data/historico.db \
  "SELECT COUNT(*) as total,
          MIN(datetime(timestamp,'unixepoch','localtime')) as inicio,
          MAX(datetime(timestamp,'unixepoch','localtime')) as fim
   FROM historico;"
```

### 3.3 Estatísticas por sinal

```bash
psql -U eracing -d telemetria -h localhost -c "
SELECT
    signal_name,
    COUNT(*) as amostras,
    round(AVG(value)::numeric, 2) as media,
    round(MIN(value)::numeric, 2) as minimo,
    round(MAX(value)::numeric, 2) as maximo,
    unit
FROM sensor_data
WHERE time > NOW() - INTERVAL '1 minute'
GROUP BY signal_name, unit
ORDER BY amostras DESC;"
```

---

## PARTE 4 — MONITORAR A REDE

### Banda em tempo real por interface

```bash
sudo apt install -y iftop nload nethogs
sudo iftop -i enp1s0       # por conexão
nload enp1s0               # gráfico entrada/saída
sudo nethogs enp1s0        # por processo
```

### Script de log de rede

```bash
#!/bin/bash
# Salva uso de banda a cada segundo
IFACE="enp1s0"
PREV_RX=0; PREV_TX=0

while true; do
    RX=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
    TX=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)
    [ $PREV_RX -gt 0 ] && echo "$(date '+%H:%M:%S') RX:$((RX-PREV_RX))B/s TX:$((TX-PREV_TX))B/s"
    PREV_RX=$RX; PREV_TX=$TX
    sleep 1
done
```

---

## PARTE 5 — RECONEXÃO AUTOMÁTICA

Se o Wi-Fi cair durante a corrida, o edge salva tudo localmente no Jetson:

```bash
# Ver quantos frames estão pendentes no backup local (no Jetson)
sqlite3 ~/telemetry-edge/telemetria_backup.db \
  "SELECT COUNT(*) as pendentes FROM raw_can_logs WHERE synced = 0;"
```

Quando o Wi-Fi voltar, o edge detecta automaticamente, reconecta e reenvia todos os frames pendentes **antes** de retomar a transmissão ao vivo.

---

## PARTE 6 — REFERÊNCIA DE ARGUMENTOS DO EDGE

| Argumento | Padrão | Descrição |
|---|---|---|
| `--pasta_csv` | obrigatório | Pasta com CSVs de IDs CAN |
| `--ch0` | desabilitado | Interface SocketCAN (ex: `can0`) |
| `--ch1` | desabilitado | Canal Kvaser (ex: `0`) |
| `--bitrate0` | `500000` | Bitrate canal 0 |
| `--bitrate1` | `250000` | Bitrate canal 1 |
| `--server` | `192.168.1.100:8080` | Endereço do servidor |
| `--device_id` | `car_001` | Identificador do carro |
| `--db_path` | `sqlite:telemetria_backup.db` | Backup local |
| `--batch_size` | `10` | Frames por lote TCP |

---

## SEQUÊNCIA DE INICIALIZAÇÃO PARA CORRIDA

```
1. [ SERVIDOR ] Ligar e confirmar IP:        ip addr show
2. [ SERVIDOR ] Verificar PostgreSQL:        sudo systemctl status postgresql
3. [ SERVIDOR ] Rodar telemetry-server:      cd ~/telemetry-server && ./target/release/telemetry-server
4. [ CARRO    ] Ligar Jetson
5. [ ANTENAS  ] Confirmar link Wi-Fi:        painel Unifi → ver RSSI entre as antenas
6. [ CARRO    ] Verificar ping:              ping 192.168.1.100
7. [ CARRO    ] Subir CAN:                   sudo ip link set can0 type can bitrate 500000 && sudo ip link set up can0
8. [ CARRO    ] Confirmar dados CAN:         candump can0
9. [ CARRO    ] Rodar telemetry-edge:        ./target/release/telemetry-edge --pasta_csv ./csv_data --ch0 can0 --server 192.168.1.100:8080
10.[ SERVIDOR ] Confirmar dados chegando:    watch -n 1 "psql -U eracing -d telemetria -h localhost -t -c 'SELECT COUNT(*) FROM sensor_data;'"
```

---

## SOLUÇÃO DE PROBLEMAS

**`Connection refused 192.168.1.100:8080`**
O servidor não está rodando. Verifique:
```bash
ps aux | grep telemetry-server
cd ~/telemetry-server && ./target/release/telemetry-server
```

**Sem dados no banco mas edge conectou**
Os CAN IDs do CSV podem não bater com o barramento real:
```bash
candump can0 | head -5         # ver IDs reais
grep "19B5" csv_data/*.csv     # confirmar se estão no CSV
```

**PostgreSQL erro de autenticação**
```bash
sudo -u postgres psql -c "ALTER USER eracing WITH PASSWORD 'eracing_secret';"
```

**Edge conecta mas perde conexão frequentemente**
Verificar qualidade do link Wi-Fi no painel Unifi. RSSI abaixo de -70dBm causa instabilidade.

**`can0: no such device`**
```bash
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0
```

---

*Documentação E-Racing Ultra Blaster Telemetria V2 — 01/03/2026*