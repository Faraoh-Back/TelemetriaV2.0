# GUIA DE INSTALAÇÃO — SERVIDOR TELEMETRIA V2
**Versão:** 2.1  
**Data:** 01 de Março de 2026  
**Objetivo:** Instalar e configurar o servidor de telemetria com a topologia de rede real da equipe.

---

## TOPOLOGIA DE REDE REAL

```
[SERVIDOR]                    BASE DE AQUISIÇÕES              [CARRO]
Ubuntu Server
192.168.1.100
     |
     | Cabo Ethernet
     |
  [ROTEADOR]  ←── Vocês NÃO gerenciam este roteador pelo servidor
     |              O roteador apenas roteia pacotes
     |
  [Antena Unifi AC Mesh]  ← montada na base, aponta para o carro
     |
     ~ ~ ~ Wi-Fi ~ ~ ~
     |
  [Antena Unifi AC Mesh]  ← montada no carro
     |
     | Cabo Ethernet
     |
  [JETSON] (edge)
  192.168.1.101
```

**Importante:** O roteador é apenas um roteador — ele não precisa ser configurado pelo servidor. O servidor recebe os dados via TCP na porta 8080. A comunicação Wi-Fi entre as antenas Unifi é configurada diretamente no painel das antenas (IP padrão 192.168.1.20), não pelo servidor.

---

## PASSO 1 — INSTALAR UBUNTU SERVER 22.04

### 1.1 Criar pendrive bootável

**Windows:**
```
1. Baixe Rufus: https://rufus.ie/
2. Baixe Ubuntu Server 22.04: https://ubuntu.com/download/server
3. Insira pendrive (mínimo 4GB)
4. Abra Rufus → selecione ISO → Start
```

**Linux:**
```bash
sudo dd if=ubuntu-22.04.3-live-server-amd64.iso of=/dev/sdX bs=4M status=progress && sync
```

### 1.2 Instalação (dual boot com Windows)

1. Reinicie com o pendrive → F12/F2/Del para boot menu
2. Selecione "Install Ubuntu Server"
3. Idioma: English (melhor suporte)
4. Rede: deixe DHCP por enquanto
5. **Storage — IMPORTANTE para dual boot:**
   - Escolha "Custom storage layout"
   - Identifique a partição que você criou para o Ubuntu (pelo tamanho)
   - Delete ela → vira "free space"
   - Selecione o free space → Add GPT Partition
   - Format: **ext4**, Mount: **/**
   - **NÃO mexa nas partições do Windows (NTFS)**
6. Usuário: `eracing` / Senha: sua preferência
7. Marque: ✅ Install OpenSSH server
8. Snaps: não selecione nenhum
9. Aguarde ~10 minutos → reinicie

---

## PASSO 2 — CONFIGURAÇÃO INICIAL DO SISTEMA

### 2.1 Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget vim htop net-tools build-essential pkg-config libssl-dev
```

### 2.2 Descobrir o nome da interface ethernet

```bash
ip link show
```

Procure a interface que mostra `state UP` com cabo conectado. Geralmente `enp1s0`, `enp5s0` ou `eth0`. **Anote o nome exato.**

### 2.3 Configurar IP fixo via ethernet

```bash
# Substitua enp1s0 pelo nome real da sua interface
sudo bash -c 'cat > /etc/netplan/00-installer-config.yaml << EOF
network:
  version: 2
  ethernets:
    enp1s0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
EOF'

sudo netplan apply
```

### 2.4 Verificar IP e internet

```bash
ip addr show enp1s0
# Deve mostrar: inet 192.168.1.100/24

ping -c 3 8.8.8.8
# Deve responder normalmente
```

**Se não tiver internet após configurar o IP fixo:**
```bash
# DNS conflitando — força resolução direta
sudo bash -c 'echo "nameserver 8.8.8.8" > /etc/resolv.conf'
ping -c 3 google.com
```

---

## PASSO 3 — INSTALAR POSTGRESQL + TIMESCALEDB

O TimescaleDB é uma extensão do PostgreSQL especializada em séries temporais. Usamos ele para dados em **tempo real** (últimos 7 dias) e o SQLite para **histórico** completo.

### 3.1 Instalar PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 3.2 Instalar TimescaleDB

```bash
# Adicionar repositório TimescaleDB
sudo apt install -y gnupg postgresql-common apt-transport-https lsb-release wget

sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh

echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -c -s) main" \
    | sudo tee /etc/apt/sources.list.d/timescaledb.list

wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey | sudo apt-key add -

sudo apt update
sudo apt install -y timescaledb-2-postgresql-14
```

### 3.3 Configurar PostgreSQL + TimescaleDB

```bash
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql
```

### 3.4 Criar banco e usuário

```bash
sudo -u postgres psql << EOF
CREATE USER eracing WITH PASSWORD 'eracing_secret';
CREATE DATABASE telemetria OWNER eracing;
GRANT ALL PRIVILEGES ON DATABASE telemetria TO eracing;
EOF
```

### 3.5 Verificar conexão

```bash
psql -U eracing -d telemetria -h localhost -c "SELECT version();"
# Deve mostrar a versão do PostgreSQL
```

---

## PASSO 4 — INSTALAR SQLITE

```bash
sudo apt install -y sqlite3
sqlite3 --version
# Deve mostrar: 3.37.x
```

---

## PASSO 5 — INSTALAR RUST

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Quando perguntar: pressione 1 (padrão)

source ~/.cargo/env
echo 'source ~/.cargo/env' >> ~/.bashrc

# Verificar
rustc --version
cargo --version
```

**Nunca use `sudo cargo`** — o Rust é instalado por usuário. Sempre compile sem sudo.

---

## PASSO 6 — MONTAR ESTRUTURA DO SERVIDOR

```bash
# Sempre na pasta home — nunca em /
mkdir -p ~/telemetry-server/src
mkdir -p ~/telemetry-server/csv_data
mkdir -p ~/telemetry-server/data
cd ~/telemetry-server
```

Estrutura final esperada:
```
~/telemetry-server/
├── Cargo.toml
├── csv_data/
│   └── CAN Description 2025 - VCU.csv
├── data/                    ← SQLite será criado aqui automaticamente
└── src/
    ├── main.rs
    └── decoder.rs
```

Copie os arquivos `main.rs`, `decoder.rs` e `Cargo.toml` para as pastas acima.

---

## PASSO 7 — COMPILAR E RODAR O SERVIDOR

### 7.1 Compilar

```bash
cd ~/telemetry-server
cargo build --release
# Primeira vez: ~5-10 minutos
# Compilações seguintes: ~30 segundos
```

### 7.2 Rodar em primeiro plano (para ver logs)

```bash
cd ~/telemetry-server
./target/release/telemetry-server
```

Saída esperada:
```
🚀 Telemetry Server v2.0 — Dual DB Edition
   TimescaleDB → tempo real | SQLite → histórico
✅ 47 CAN IDs carregados do CSV
✅ TimescaleDB inicializado (tempo real, retenção 7 dias)
✅ SQLite inicializado (histórico persistente)
📡 TCP listener em 0.0.0.0:8080
🌐 WebSocket em 0.0.0.0:8081
✅ Servidor pronto!
```

### 7.3 Rodar em background

```bash
cd ~/telemetry-server
nohup ./target/release/telemetry-server > ~/telemetry-server/server.log 2>&1 &
echo $! > ~/telemetry-server/server.pid
echo "Servidor rodando — PID: $(cat ~/telemetry-server/server.pid)"
```

Ver logs:
```bash
tail -f ~/telemetry-server/server.log
```

Parar:
```bash
kill $(cat ~/telemetry-server/server.pid)
```

---

## PASSO 8 — CONFIGURAR AS ANTENAS UNIFI

As antenas Unifi AC Mesh são configuradas diretamente no painel web delas, **não pelo servidor**. O servidor apenas usa a rede que as antenas fornecem.

### 8.1 Acessar painel da antena base

```
1. Conecte um computador diretamente na antena via cabo
2. Acesse: https://192.168.1.20 (IP padrão Unifi)
3. Usuário: ubnt / Senha: ubnt (padrão de fábrica)
```

### 8.2 Configurar como Access Point (antena base)

```
Wireless → Mode: Access Point
SSID: eracing_telemetry
Security: WPA2
Password: (sua senha)
Frequency: 5GHz (menos interferência que 2.4GHz)
Channel Width: 40MHz ou 80MHz
```

### 8.3 Configurar como Station (antena do carro)

```
Wireless → Mode: Station
SSID: eracing_telemetry (mesmo da base)
Password: (mesma senha)
```

### 8.4 Verificar link

No painel da antena base deve aparecer a antena do carro conectada com RSSI (sinal) e taxa de link.

---

## PASSO 9 — VERIFICAR SISTEMA COMPLETO

### 9.1 Ver dados no TimescaleDB (tempo real)

```bash
psql -U eracing -d telemetria -h localhost -c "
SELECT
    time,
    signal_name,
    round(value::numeric, 2) as valor,
    unit,
    device_id
FROM sensor_data
ORDER BY time DESC
LIMIT 20;"
```

### 9.2 Ver dados no SQLite (histórico)

```bash
sqlite3 ~/telemetry-server/data/historico.db \
  "SELECT datetime(timestamp,'unixepoch','localtime') as hora,
          signal_name,
          printf('%.2f', value) as valor,
          unit
   FROM historico
   ORDER BY id DESC
   LIMIT 20;"
```

### 9.3 Monitorar chegada de dados em tempo real

```bash
watch -n 1 "psql -U eracing -d telemetria -h localhost -t -c \
  'SELECT COUNT(*) as registros_timescale FROM sensor_data;'"
```

---

## SOLUÇÃO DE PROBLEMAS

**`cargo: command not found` com sudo**
```bash
# Nunca use sudo com cargo
source ~/.cargo/env
cargo build --release   # sem sudo
```

**`Permission denied` ao criar pastas**
```bash
# Use sempre ~/  (home) — nunca /
mkdir -p ~/telemetry-server/src   # ✅ correto
mkdir -p /telemetry-server/src    # ❌ errado
```

**Sem internet após configurar IP fixo**
```bash
sudo bash -c 'echo "nameserver 8.8.8.8" > /etc/resolv.conf'
```

**PostgreSQL não conecta**
```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "\l"   # lista bancos
```

**Porta 8080 já em uso**
```bash
sudo ss -tulpn | grep 8080
sudo kill $(sudo lsof -t -i:8080)
```