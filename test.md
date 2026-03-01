# GUIA DE INSTALAÇÃO COMPLETO - SERVIDOR TELEMETRIA V2

**Versão:** 2.0 Prático  
**Data:** 15 de Fevereiro de 2026  
**Objetivo:** Servidor pronto para APK Android conectar e visualizar dados

---

## 📥 PASSO 1: PREPARAR O NOTEBOOK

### 1.1 Baixar Ubuntu Server 22.04 LTS

```bash
# No seu computador atual, baixe:
Link: https://ubuntu.com/download/server
Arquivo: ubuntu-22.04.3-live-server-amd64.iso (2GB)
```

### 1.2 Criar Pendrive Bootável

**Windows:**
- Baixe Rufus: https://rufus.ie/
- Insira pendrive (mínimo 4GB)
- Abra Rufus, selecione o ISO do Ubuntu
- Clique em "Start" e aguarde

**Linux/Mac:**
```bash
# Identifique o pendrive
lsblk

# Grave a ISO (substitua /dev/sdX pelo seu pendrive)
sudo dd if=ubuntu-22.04.3-live-server-amd64.iso of=/dev/sdX bs=4M status=progress && sync
```

---

## 💿 PASSO 2: INSTALAR UBUNTU SERVER

### 2.1 Bootar do Pendrive

1. Insira o pendrive no notebook
2. Reinicie e pressione F12/F2/Del (varia por fabricante)
3. Selecione boot pelo pendrive USB
4. Escolha "Install Ubuntu Server"

### 2.2 Configurações de Instalação

**Idioma:** Português do Brasil (ou English para melhor suporte)

**Configuração de Rede:**
```
Interface: eth0 ou wlan0
Método: DHCP (depois configuraremos IP fixo)
```

**Configuração de Storage:**
```
Opção: Use entire disk
Filesystem: ext4
Particionamento: Guided - use entire disk
```

**Informações do Servidor:**
```
Nome do servidor: telemetry-server
Seu nome: racing
Nome de usuário: racing
Senha: [escolha uma senha forte]
```

**SSH Server:** ✅ Marque "Install OpenSSH server"

**Featured Server Snaps:** Não selecione nenhum (instalaremos manualmente)

### 2.3 Finalizar Instalação

1. Aguarde a instalação completar (~10 minutos)
2. Remova o pendrive quando solicitado
3. Reinicie o sistema
4. Faça login com usuário e senha criados

---

## 🌐 PASSO 3: CONFIGURAÇÃO INICIAL DO SISTEMA

### 3.1 Atualizar o Sistema

```bash
# Login como racing
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget vim htop net-tools
```

### 3.2 Configurar IP Fixo para o Servidor

```bash
# Identificar interface de rede
ip addr show

# Editar configuração de rede (supondo interface wlan0 para WiFi)
sudo nano /etc/netplan/00-installer-config.yaml
```

**Conteúdo do arquivo:**
```yaml
network:
  version: 2
  wifis:
    wlan0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
      access-points:
        "ERacing_Telemetry_WiFi":
          password: "SenhaSegura123!"
```

**Se usar Ethernet (eth0):**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
```

**Aplicar configuração:**
```bash
sudo netplan apply
```

**Verificar:**
```bash
ip addr show
ping 8.8.8.8
```

---

## 📡 PASSO 4: CONFIGURAR REDE WiFi PRIVADA

### 4.1 Instalar Access Point + DHCP

```bash
# Instalar hostapd (Access Point) e dnsmasq (DHCP/DNS)
sudo apt install -y hostapd dnsmasq

# Parar serviços para configurar
sudo systemctl stop hostapd
sudo systemctl stop dnsmasq
```

### 4.2 Configurar Interface WiFi Estática

```bash
sudo nano /etc/dhcpcd.conf
```

**Adicionar no final:**
```
interface wlan0
    static ip_address=192.168.1.1/24
    nohook wpa_supplicant
```

### 4.3 Configurar DHCP Server (dnsmasq)

```bash
# Backup da configuração original
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig

# Criar nova configuração
sudo nano /etc/dnsmasq.conf
```

**Conteúdo:**
```
interface=wlan0
dhcp-range=192.168.1.10,192.168.1.50,255.255.255.0,24h
domain=telemetry.local
address=/telemetry.local/192.168.1.1
```

### 4.4 Configurar Access Point (hostapd)

```bash
sudo nano /etc/hostapd/hostapd.conf
```

**Conteúdo:**
```
interface=wlan0
driver=nl80211
ssid=ERacing_Telemetry_WiFi
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=SenhaSegura123!
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
```

**Indicar arquivo de configuração:**
```bash
sudo nano /etc/default/hostapd
```

**Descomentar e editar:**
```
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

### 4.5 Habilitar IP Forwarding (Opcional, se precisar internet)

```bash
sudo nano /etc/sysctl.conf
```

**Descomentar:**
```
net.ipv4.ip_forward=1
```

**Aplicar:**
```bash
sudo sysctl -p
```

### 4.6 Iniciar Serviços

```bash
# Recarregar daemon
sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl enable dnsmasq

# Reiniciar serviços
sudo systemctl start hostapd
sudo systemctl start dnsmasq

# Verificar status
sudo systemctl status hostapd
sudo systemctl status dnsmasq
```

### 4.7 Verificar Rede WiFi

```bash
# De outro dispositivo (celular/laptop):
# 1. Buscar rede WiFi "ERacing_Telemetry_WiFi"
# 2. Conectar com senha "SenhaSegura123!"
# 3. Verificar se recebe IP (192.168.1.10-50)
# 4. Pingar o servidor: ping 192.168.1.1
```

---

## 🗄️ PASSO 5: CONFIGURAR BANCO DE DADOS

### 5.1 Instalar SQLite (Já vem instalado)

```bash
# Verificar instalação
sqlite3 --version
```

### 5.2 Criar Estrutura de Diretórios

```bash
# Criar estrutura de pastas
mkdir -p ~/telemetry_server/{data/db,config,logs}
cd ~/telemetry_server
```

### 5.3 Criar Banco de Dados Inicial

```bash
sqlite3 data/db/telemetria.db
```

**Dentro do SQLite, executar:**
```sql
-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Tabela de telemetria
CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL DEFAULT 1,
    timestamp REAL NOT NULL,
    device_id TEXT NOT NULL,
    can_id TEXT NOT NULL,
    signal_name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT,
    quality TEXT DEFAULT 'ok',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_timestamp ON telemetry(timestamp);
CREATE INDEX IF NOT EXISTS idx_signal ON telemetry(signal_name);
CREATE INDEX IF NOT EXISTS idx_device ON telemetry(device_id);

-- Criar usuário admin padrão (senha: admin123)
INSERT INTO users (email, password_hash, name, role) VALUES 
('admin@eracing.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5lS7fgHxFmvXu', 'Admin E-Racing', 'admin');

-- Inserir dados de exemplo
INSERT INTO telemetry (device_id, timestamp, can_id, signal_name, value, unit) VALUES
('car_001', 1708041600.0, '0x19B50100', 'battery_voltage', 380.5, 'V'),
('car_001', 1708041601.0, '0x19B50200', 'battery_current', 120.3, 'A'),
('car_001', 1708041602.0, '0x19B50300', 'motor_temperature', 65.8, '°C');

-- Verificar
SELECT * FROM users;
SELECT * FROM telemetry;

-- Sair
.quit
```

---

## 🐍 PASSO 6: INSTALAR PYTHON E DEPENDÊNCIAS

### 6.1 Instalar Python 3 e Pip

```bash
sudo apt install -y python3 python3-pip python3-venv
python3 --version
```

### 6.2 Criar Ambiente Virtual

```bash
cd ~/telemetry_server
python3 -m venv venv
source venv/bin/activate
```

### 6.3 Instalar Dependências Python

```bash
pip install --upgrade pip

# Criar arquivo requirements.txt
cat > requirements.txt << EOF
flask==3.0.0
flask-cors==4.0.0
flask-socketio==5.3.5
bcrypt==4.1.2
pyjwt==2.8.0
paho-mqtt==1.6.1
python-socketcan==3.2.3
EOF

# Instalar dependências
pip install -r requirements.txt
```

---

## 🔐 PASSO 7: CRIAR API REST PARA AUTENTICAÇÃO

### 7.1 Criar Servidor Flask com Autenticação

```bash
nano ~/telemetry_server/api_server.py
```

**Conteúdo completo do arquivo em próximo artifact...**

