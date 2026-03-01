# GUIA DE EXECUÇÃO — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Versão:** 2.0  
**Data:** 28 de Fevereiro de 2026  
**Objetivo:** Rodar o servidor e o edge do carro para que os dados CAN sejam armazenados no banco do servidor em tempo real.

---

## VISÃO GERAL DO FLUXO

```
[CARRO]                              [SERVIDOR]
can0 (barramento físico CAN)
        ↓ socketcan
telemetry-edge ──── TCP :8080 ──────→ telemetry-server
        ↓ (se cair o Wi-Fi)                  ↓
  SQLite local backup               decoder.rs (CSV → valor físico)
  (sincroniza ao reconectar)                  ↓
                                     SQLite servidor
                                             ↓
                                      App Android
```

---

## PRÉ-REQUISITOS

| Máquina | Requisito |
|---|---|
| **Servidor** | Ubuntu Server 22.04, IP fixo `192.168.1.100`, na mesma rede Wi-Fi do carro |
| **Carro** | Linux com acesso ao barramento CAN (Raspberry Pi ou embarcado), mesma rede Wi-Fi |

---

## PARTE 1 — CONFIGURAÇÃO DO SERVIDOR

### 1.1 Instalar Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Quando perguntar, pressione 1 (instalação padrão)
source ~/.cargo/env

# Verificar instalação
rustc --version
cargo --version
```

### 1.2 Instalar dependências do sistema

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev sqlite3 git
```

### 1.3 Montar a estrutura de pastas

```bash
mkdir -p ~/telemetry-server/src
mkdir -p ~/telemetry-server/csv_data
mkdir -p ~/telemetry-server/data
cd ~/telemetry-server
```

Copie os arquivos para as pastas corretas:

```
~/telemetry-server/
├── Cargo.toml               ← Cargo.toml do servidor
├── csv_data/
│   └── CAN Description 2025 - VCU.csv
├── data/                    ← banco será criado aqui
└── src/
    ├── main.rs              ← main.rs do servidor
    └── decoder.rs           ← decoder.rs
```

### 1.4 Cargo.toml do servidor

Crie o arquivo `~/telemetry-server/Cargo.toml` com o conteúdo:

```toml
[package]
name = "telemetry-server"
version = "2.0.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio-native-tls"] }
csv = "1"
serde = { version = "1", features = ["derive"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

### 1.5 Criar o banco de dados do servidor

```bash
sqlite3 ~/telemetry-server/data/telemetria.db "
CREATE TABLE IF NOT EXISTS telemetry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   REAL    NOT NULL,
    device_id   TEXT    NOT NULL,
    can_id      TEXT    NOT NULL,
    signal_name TEXT    NOT NULL,
    value       REAL    NOT NULL,
    unit        TEXT,
    channel     TEXT,
    priority    INTEGER DEFAULT 4,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timestamp   ON telemetry(timestamp);
CREATE INDEX IF NOT EXISTS idx_signal_name ON telemetry(signal_name);
CREATE INDEX IF NOT EXISTS idx_device_id   ON telemetry(device_id);
"
echo "✅ Banco criado com sucesso"
```

### 1.6 Verificar IP fixo do servidor

```bash
ip addr show
# Confirme que aparece 192.168.1.100 na interface de rede
```

Se o IP ainda não estiver fixo, configure via netplan:

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

Conteúdo para Wi-Fi:

```yaml
network:
  version: 2
  wifis:
    wlan0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8]
      access-points:
        "NOME_DA_REDE":
          password: "SENHA_DA_REDE"
```

Aplique:

```bash
sudo netplan apply
ip addr show   # confirme o IP
```

### 1.7 Compilar o servidor

```bash
cd ~/telemetry-server
cargo build --release
# Primeira compilação demora ~5 minutos
# Compilações seguintes são rápidas
```

Saída esperada ao final:
```
Compiling telemetry-server v2.0.0
 Finished release [optimized] target(s) in 4m 32s
```

### 1.8 Rodar o servidor

**Em primeiro plano (para ver os logs ao vivo):**

```bash
cd ~/telemetry-server
./target/release/telemetry-server
```

Saída esperada:
```
✅ Mapa CAN carregado: 47 sinais
✅ Banco SQLite inicializado
🚀 Servidor TCP escutando em 0.0.0.0:8080
```

**Em background (para deixar rodando e fechar o terminal):**

```bash
cd ~/telemetry-server
nohup ./target/release/telemetry-server > server.log 2>&1 &
echo "Servidor rodando com PID: $!"
```

Para ver os logs depois:

```bash
tail -f ~/telemetry-server/server.log
```

Para parar:

```bash
kill $(cat server.pid)
# ou
pkill telemetry-server
```

---

## PARTE 2 — CONFIGURAÇÃO DO CARRO (EDGE)

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

### 2.10 Rodar o edge

**Somente SocketCAN:**

```bash
cd ~/telemetry-edge
./target/release/telemetry-edge \
    --pasta_csv ./csv_data \
    --ch0 can0 \
    --server 192.168.1.100:8080 \
    --device_id car_001
```

**SocketCAN + Kvaser canal 0:**

```bash
./target/release/telemetry-edge \
    --pasta_csv ./csv_data \
    --ch0 can0 \
    --ch1 0 \
    --bitrate1 250000 \
    --server 192.168.1.100:8080 \
    --device_id car_001
```

Saída esperada:

```
═══════════════════════════════════════════════════════
  Telemetria Edge — SocketCAN + Kvaser SDK Edition
  Servidor: 192.168.1.100:8080
  Dispositivo: car_001
═══════════════════════════════════════════════════════

📂 Carregando CSVs de './csv_data'...
  CAN Description 2025 - VCU.csv   → Prioridade 1  (47 IDs)
✅ Mapa de prioridades: 47 IDs únicos

✅ Banco SQLite inicializado: sqlite:telemetria_backup.db
✅ SocketCAN 'can0' aberto
🔌 Tentando conectar ao servidor: 192.168.1.100:8080
✅ Conectado ao servidor!
📊 Enviados: 1000 | Backup: 0 | Último: ID=0x19B50100 Prio=1 Canal=can0
```

---

## PARTE 3 — VERIFICAR QUE ESTÁ FUNCIONANDO

### 3.1 Ver dados chegando no banco do servidor

No servidor, execute:

```bash
sqlite3 ~/telemetry-server/data/telemetria.db \
  "SELECT datetime(timestamp,'unixepoch','localtime') as hora,
          signal_name,
          printf('%.2f', value) as valor,
          unit,
          device_id
   FROM telemetry
   ORDER BY id DESC
   LIMIT 20;"
```

Saída esperada:

```
2026-02-28 20:30:01 | battery_voltage    | 380.50 | V   | car_001
2026-02-28 20:30:01 | battery_current    | 120.30 | A   | car_001
2026-02-28 20:30:02 | motor_temperature  | 65.80  | °C  | car_001
```

### 3.2 Monitorar contador de registros em tempo real

```bash
watch -n 1 "sqlite3 ~/telemetry-server/data/telemetria.db \
  'SELECT COUNT(*) as total_registros,
          MAX(datetime(timestamp,\"unixepoch\",\"localtime\")) as ultimo_dado
   FROM telemetry;'"
```

O `total_registros` deve aumentar a cada segundo enquanto o carro estiver transmitindo.

### 3.3 Ver estatísticas por sinal

```bash
sqlite3 ~/telemetry-server/data/telemetria.db \
  "SELECT signal_name,
          COUNT(*) as amostras,
          printf('%.2f', AVG(value)) as media,
          printf('%.2f', MIN(value)) as minimo,
          printf('%.2f', MAX(value)) as maximo,
          unit
   FROM telemetry
   GROUP BY signal_name
   ORDER BY amostras DESC;"
```

---

## PARTE 4 — COMPORTAMENTO DE RECONEXÃO

O sistema foi projetado para ser resiliente. Se o Wi-Fi cair durante a corrida:

**No carro:** os frames CAN continuam sendo lidos e salvos no SQLite local (`telemetria_backup.db`).

**Quando o Wi-Fi voltar:** o edge detecta a reconexão, conecta ao servidor automaticamente e envia todos os dados pendentes antes de continuar transmitindo ao vivo.

Para ver os dados pendentes no backup local do carro:

```bash
sqlite3 ~/telemetry-edge/telemetria_backup.db \
  "SELECT COUNT(*) as pendentes FROM raw_can_logs WHERE synced = 0;"
```

---

## PARTE 5 — REFERÊNCIA DE ARGUMENTOS DO EDGE

| Argumento | Padrão | Descrição |
|---|---|---|
| `--pasta_csv` | obrigatório | Pasta com CSVs de IDs CAN |
| `--ch0` | desabilitado | Interface SocketCAN (ex: `can0`) |
| `--ch1` | desabilitado | Número do canal Kvaser (ex: `0`) |
| `--bitrate0` | `500000` | Bitrate do canal 0 |
| `--bitrate1` | `250000` | Bitrate do canal 1 |
| `--server` | `192.168.1.100:8080` | Endereço do servidor |
| `--device_id` | `car_001` | Identificador do carro |
| `--db_path` | `sqlite:telemetria_backup.db` | Caminho do banco de backup |
| `--batch_size` | `10` | Frames por lote TCP |

---

## PARTE 6 — SOLUÇÃO DE PROBLEMAS

### `can0: no such device`
A interface CAN não foi inicializada. Execute:
```bash
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0
```

### `Connection refused 192.168.1.100:8080`
O servidor não está rodando ou o IP está errado. Verifique:
```bash
ping 192.168.1.100
# No servidor:
ps aux | grep telemetry-server
```

### `error opening database`
O arquivo do banco não existe. Crie-o manualmente:
```bash
touch telemetria_backup.db
```

### `Cargo.lock conflito` ou erro de compilação
Delete os artefatos e recompile:
```bash
rm -rf target Cargo.lock
cargo build --release
```

### Nenhum dado aparece no banco do servidor
Verifique se os CAN IDs do CSV batem com os IDs que chegam no barramento:
```bash
# No carro, veja os IDs que estão chegando
candump can0 | head -20

# Confirme que esses IDs existem no CSV
grep "19B5" ~/telemetry-edge/csv_data/*.csv
```

### Edge conecta mas nenhum frame é enviado
Confirme que o `can0` está UP e com dados:
```bash
ip link show can0     # deve estar UP
candump can0          # deve mostrar frames
```

---

## SEQUÊNCIA DE INICIALIZAÇÃO RECOMENDADA PARA CORRIDA

```
1. Ligar servidor e confirmar IP (ip addr show)
2. Rodar telemetry-server no servidor
3. Ligar o carro e conectar na rede Wi-Fi
4. Subir interface CAN (ip link set can0 up)
5. Confirmar dados no CAN (candump can0)
6. Rodar telemetry-edge no carro
7. Confirmar no servidor que os dados estão chegando (watch sqlite3)
```

---

*Documentação gerada para o projeto E-Racing Ultra Blaster Telemetria V2*
