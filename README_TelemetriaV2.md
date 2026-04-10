# TELEMETRIA V2.0 — E-RACING ULTRA BLASTER
## README Operacional — Comandos, Diagnóstico e Resolução de Problemas

> **Versão:** 2.0 — Pipeline CAN → Edge → Servidor → Interface Web  
> **Última atualização:** 03/04/2026 — Dia 5  
> **Repositório:** github.com/Faraoh-Back/TelemetriaV2.0

---

## ÍNDICE

1. [Arquitetura do sistema](#1-arquitetura-do-sistema)
2. [IPs e portas](#2-ips-e-portas)
3. [Iniciar o sistema](#3-iniciar-o-sistema)
4. [Comandos do servidor](#4-comandos-do-servidor)
5. [Comandos da Jetson](#5-comandos-da-jetson)
6. [Interface web](#6-interface-web)
7. [Banco de dados](#7-banco-de-dados)
8. [Monitoramento](#8-monitoramento)
9. [Resolução de problemas](#9-resolução-de-problemas)
10. [Deploy de novo código](#10-deploy-de-novo-código)
11. [Referência de serviços systemd](#11-referência-de-serviços-systemd)

---

## 1. ARQUITETURA DO SISTEMA

```
JETSON AGX XAVIER (192.168.1.6)
  can0/can1 → barramento CAN do carro (500kbps)
  vcan0/vcan1 → simulação (canplayer com log)
  telemetry-edge → lê CAN → TCP → servidor

  ─────── Rede 192.168.1.x (cabo + Unifi) ───────

SERVIDOR UBUNTU (192.168.1.100)
  TCP :8080 → recebe frames do edge
  HTTP :8081 → serve interface web
  WS :8081/ws → broadcast dados em tempo real
  TimescaleDB → dados tempo real (7 dias)
  SQLite → histórico permanente

BROWSER (qualquer dispositivo na rede)
  http://192.168.1.100:8081 → login JWT → dashboard
```

---

## 2. IPs E PORTAS

| Dispositivo | IP | Interface |
|---|---|---|
| Servidor | 192.168.1.100 | enp1s0 (cabo fixo) |
| Jetson | 192.168.1.6 | eth0 (DHCP) |
| Roteador | 192.168.1.1 | — |

| Porta | Protocolo | Uso |
|---|---|---|
| 8080 | TCP binário | Edge → Servidor (frames CAN) |
| 8081 | HTTP + WebSocket | Interface web + dados em tempo real |
| 5432 | PostgreSQL | Interno (não exposto) |

---

## 3. INICIAR O SISTEMA

### Boot automático (normal — não precisa fazer nada)

Ligue o servidor e a Jetson. Tudo sobe automaticamente:

```
Servidor: ~90s até telemetria pronta
Jetson:   ~51s até dados chegando no servidor
```

Abra o browser em `http://192.168.1.100:8081` e faça login.

### Iniciar manualmente (se necessário)

**No servidor:**
```bash
sudo systemctl start telemetry
```

**Na Jetson (em ordem):**
```bash
sudo systemctl start can-interfaces
sudo systemctl start can-replay
sudo systemctl start telemetry-edge
```

---

## 4. COMANDOS DO SERVIDOR

### Serviço

```bash
# Status
sudo systemctl status telemetry

# Iniciar / Parar / Reiniciar
sudo systemctl start telemetry
sudo systemctl stop telemetry
sudo systemctl restart telemetry

# Ver logs em tempo real
sudo journalctl -u telemetry -f

# Ver últimas 50 linhas de log
sudo journalctl -u telemetry -n 50 --no-pager
```

### Processo manual (debug)

```bash
cd ~/TelemetriaV2.0/telemetry-server

# Parar o serviço primeiro
sudo systemctl stop telemetry
pkill -f telemetry-server

# Rodar em foreground (ver logs direto)
./target/release/telemetry-server

# Rodar em background
./target/release/telemetry-server > /tmp/telemetry.log 2>&1 &
tail -f /tmp/telemetry.log
```

### Matar processos nas portas

```bash
sudo kill -9 $(sudo lsof -ti:8080) 2>/dev/null
sudo kill -9 $(sudo lsof -ti:8081) 2>/dev/null
# ou
pkill -9 -f telemetry-server
```

### Ver quem está usando as portas

```bash
sudo lsof -i:8080
sudo lsof -i:8081
```

---

## 5. COMANDOS DA JETSON

### Serviços

```bash
# Status de todos os serviços de telemetria
sudo systemctl status can-interfaces
sudo systemctl status can-replay
sudo systemctl status telemetry-edge

# Logs do edge em tempo real
sudo journalctl -u telemetry-edge -f

# Reiniciar pipeline completo
sudo systemctl restart can-interfaces
sudo systemctl restart can-replay
sudo systemctl restart telemetry-edge
```

### Interface CAN

```bash
# Ver interfaces CAN
ip link show can0
ip link show can1
ip link show vcan0
ip link show vcan1

# Detalhes (bitrate, estado, erros)
ip -details link show can0

# Subir can0 manualmente (se necessário)
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0

# Criar vcan manualmente (se necessário)
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0
sudo ip link set vcan0 txqueuelen 1000
```

### Monitorar barramento CAN

```bash
# Ver frames chegando no vcan0 (simulação)
candump vcan0

# Ver frames no can0 (barramento real do carro)
candump can0

# Ver apenas IDs específicos
candump vcan0 | grep "19B508"

# Capturar log do barramento
candump -l can0
# Salva em candump-YYYY-MM-DD_HHMMSS.log
```

### Replay do log CAN (simulação)

```bash
# Injetar log no vcan0 em loop (modo simulação)
sudo ip link set vcan0 txqueuelen 1000
canplayer -I ~/logs/can/candump-1999-12-31_230146.log -l i -g 1 vcan0=can0

# Injetar uma vez (sem loop)
canplayer -I ~/logs/can/candump-1999-12-31_230146.log -g 1 vcan0=can0
```

### Testar conectividade com o servidor

```bash
ping -c 10 192.168.1.100
telnet 192.168.1.100 8080
```

---

## 6. INTERFACE WEB

**URL:** `http://192.168.1.100:8081`

### Gerenciar usuários

```bash
# No servidor — gerar hash da senha
pip3 install bcrypt --break-system-packages
python3 -c "import bcrypt; print(bcrypt.hashpw(b'SENHA_AQUI', bcrypt.gensalt()).decode())"

# Inserir usuário (tudo em uma linha)
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db \
  "INSERT INTO users (username, password_hash) VALUES ('nome', 'HASH_AQUI');"

# Listar usuários
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db \
  "SELECT id, username, created_at FROM users;"

# Remover usuário
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db \
  "DELETE FROM users WHERE username = 'nome';"
```

### Invalidar todos os tokens (sessões ativas)

```bash
# Trocar o JWT_SECRET no .env
nano ~/TelemetriaV2.0/telemetry-server/.env
# Alterar JWT_SECRET=...

# Reiniciar servidor
sudo systemctl restart telemetry
```

### Testar endpoints via terminal

```bash
# Testar se o servidor responde
curl -v http://192.168.1.100:8081/

# Testar login
curl -X POST http://192.168.1.100:8081/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"eracing","password":"SENHA"}'
```

---

## 7. BANCO DE DADOS

### TimescaleDB (tempo real — últimos 7 dias)

```bash
# Conectar
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost

# Contar registros
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c \
  "SELECT COUNT(*) FROM sensor_data;"

# Ver registros mais recentes
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c \
  "SELECT time, signal_name, value, unit FROM sensor_data ORDER BY time DESC LIMIT 10;"

# Ver sinais únicos disponíveis
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c \
  "SELECT DISTINCT signal_name FROM sensor_data ORDER BY signal_name;"

# Monitorar contagem em tempo real
watch -n 1 'PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c \
  "SELECT COUNT(*) FROM sensor_data;"'

# Medir latência do pipeline (últimos 5 segundos)
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c "
SELECT
  AVG(atraso_ms)::numeric(10,2) AS media_ms,
  MIN(atraso_ms)::numeric(10,2) AS min_ms,
  MAX(atraso_ms)::numeric(10,2) AS max_ms,
  STDDEV(atraso_ms)::numeric(10,2) AS desvio_ms
FROM (
  SELECT EXTRACT(EPOCH FROM (NOW() - time)) * 1000 AS atraso_ms
  FROM sensor_data
  WHERE time > NOW() - INTERVAL '5 seconds'
) t;"
```

### SQLite (histórico permanente)

```bash
# Contar registros
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db \
  "SELECT COUNT(*) FROM historico;"

# Ver registros mais recentes
sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db \
  "SELECT datetime(timestamp,'unixepoch'), signal_name, value FROM historico ORDER BY timestamp DESC LIMIT 10;"

# Tamanho do banco
ls -lh ~/TelemetriaV2.0/telemetry-server/data/historico.db
```

---

## 8. MONITORAMENTO

### Rede

```bash
# Latência e jitter
ping -c 100 192.168.1.6    # notebook → Jetson
ping -c 100 192.168.1.100  # notebook → servidor

# Banda em uso
sudo apt install iftop
sudo iftop -i enp1s0

# Por processo
sudo apt install nethogs
sudo nethogs enp1s0

# Conexões ativas nas portas da telemetria
ss -tnp | grep -E "8080|8081"
```

### Sistema

```bash
# CPU e memória do servidor de telemetria
ps aux | grep telemetry-server
top -p $(pgrep telemetry-server)

# Uso de disco
df -h
du -sh ~/TelemetriaV2.0/telemetry-server/data/
```

---

## 9. RESOLUÇÃO DE PROBLEMAS

### ❌ Porta 8080 ou 8081 em uso

```
Error: Address already in use (os error 98)
```
**Causa:** Processo anterior não foi encerrado (Ctrl+Z suspende, não mata).  
**Solução:**
```bash
sudo systemctl stop telemetry
sudo kill -9 $(sudo lsof -ti:8080 -ti:8081) 2>/dev/null
```

---

### ❌ Dois processos rodando ao mesmo tempo

**Sintoma:** Logs aparecem no terminal sem você ter rodado o servidor.  
**Causa:** Processo em background + systemd rodando simultaneamente.  
**Solução:**
```bash
pkill -9 -f telemetry-server
sudo systemctl stop telemetry
# Aguardar 2s
sudo systemctl start telemetry
```

---

### ❌ Servidor crasha imediatamente (exit-code 1)

**Sintoma:** `systemctl status telemetry` mostra `Failed` em loop.  
**Causa mais comum:** JWT_SECRET ou DB_PASSWORD não definidos.  
**Diagnóstico:**
```bash
# Rodar manualmente para ver o erro
sudo systemctl stop telemetry
cd ~/TelemetriaV2.0/telemetry-server
./target/release/telemetry-server
```
**Solução:**
```bash
cat .env  # verificar se DB_PASSWORD e JWT_SECRET existem
# Se não existir:
echo 'JWT_SECRET='$(python3 -c "import secrets; print(secrets.token_hex(32))") >> .env
```

---

### ❌ WebSocket rejeitado (sem token)

```
🔒 WS rejeitado (sem token): 192.168.1.4:XXXXX
```
**Causa:** index.html antigo enviando token no frame em vez da query string.  
**Solução:** Verificar que o `index.html` abre o WebSocket assim:
```javascript
new WebSocket(`ws://IP:8081/ws?token=${encodeURIComponent(token)}`)
```
Se não, fazer `git pull` e recompilar.

---

### ❌ Edge enviando dados sintéticos (kvaser_ch0_sim)

**Sintoma:** Log mostra `Canal=kvaser_ch0_sim`, IDs `0x100`, `0x200`, `0x300`.  
**Causa:** Sem barramento CAN físico + interface errada configurada.  
**Solução:**
```bash
# Verificar se vcan0 está UP
ip link show vcan0

# Se não estiver, criar
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0

# Reiniciar edge com --ch0 vcan0
sudo systemctl restart telemetry-edge
```

---

### ❌ canplayer: No buffer space available

```
sendto: No buffer space available
```
**Causa:** Buffer do CAN saturado — frames injetados mais rápido que o processamento.  
**Solução:**
```bash
sudo ip link set vcan0 txqueuelen 1000
canplayer -I ~/logs/can/ARQUIVO.log -l i -g 1 vcan0=can0
```

---

### ❌ candump can0 não mostra nada (barramento físico)

**Causa:** can0 é hardware físico — sem nó CAN respondendo, frames falham no ACK.  
**Explicação:** O protocolo CAN exige confirmação (ACK bit) de pelo menos um nó receptor. Sem o carro conectado, nenhum frame é aceito.  
**Solução:** Usar vcan0 para testes. Para can0 real, precisa do carro ligado e conectado.

---

### ❌ git push falha — porta 22 bloqueada

```
ssh: connect to host github.com port 22: Network is unreachable
```
**Solução A:** Trocar para HTTPS:
```bash
git remote set-url origin https://github.com/Faraoh-Back/TelemetriaV2.0.git
git push  # usa token pessoal como senha
```
**Solução B:** Usar hotspot do celular temporariamente.

---

### ❌ psql pede senha interativamente

**Solução:** Passar senha via variável de ambiente:
```bash
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost
```

---

### ❌ Serviço systemd com erro de parse

```
Missing '=', ignoring line
Failed to parse service type
```
**Causa:** Caracteres especiais ou `:` em vez de `=` no arquivo `.service`.  
**Solução:**
```bash
sudo nano /etc/systemd/system/telemetry.service
# Verificar:
# Description= (não Description:)
# Type=simple (não Type=simpĺe)
sudo systemctl daemon-reload
sudo systemctl restart telemetry
```

---

### ❌ Jetson sem internet após reboot

**Causa:** Rota default pode não ter sido restaurada.  
**Solução:**
```bash
ip route show  # verificar se tem default via 192.168.1.100
sudo ip route add default via 192.168.1.100 dev eth0
ping 8.8.8.8   # confirmar internet
```
Se sumir após reboot, verificar dispatcher:
```bash
cat /etc/NetworkManager/dispatcher.d/99-eracing-route.sh
```

---

### ❌ Relógio da Jetson errado (ano 2000)

**Causa:** Jetson sem bateria RTC ou NTP não sincronizou.  
**Solução:**
```bash
sudo ntpdate -u pool.ntp.org
date  # confirmar data correta
```

---

### ❌ Interface web abre mas não mostra dados

**Checklist em ordem:**
```bash
# 1. Servidor está rodando?
sudo systemctl status telemetry

# 2. Edge está conectado?
sudo journalctl -u telemetry-edge -f
# Deve mostrar: ✅ Conectado ao servidor!

# 3. Dados chegando no banco?
PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c \
  "SELECT COUNT(*) FROM sensor_data WHERE time > NOW() - INTERVAL '1 minute';"

# 4. WebSocket conectando?
# No browser: F12 → Network → WS → verificar status 101
```

---

## 10. DEPLOY DE NOVO CÓDIGO

### Fluxo correto

```bash
# 1. No PC — editar, commitar, push
git add src/main.rs static/index.html
git commit -m "descrição da mudança"
git push

# 2. No servidor — pull e recompilar
sudo systemctl stop telemetry
cd ~/TelemetriaV2.0/telemetry-server
git pull
cargo build --release
sudo systemctl start telemetry
sudo systemctl status telemetry

# 3. Na Jetson — se o edge mudou
sudo systemctl stop telemetry-edge
cd ~/TelemetriaV2.0/telemetry-edge
git pull
cargo build --release
sudo systemctl start telemetry-edge
```

### Sem acesso ao GitHub (usar scp)

```bash
# Do notebook para o servidor
scp src/main.rs eracing@192.168.1.100:~/TelemetriaV2.0/telemetry-server/src/main.rs
scp static/index.html eracing@192.168.1.100:~/TelemetriaV2.0/telemetry-server/static/index.html

# Do notebook para a Jetson
scp telemetry-edge/src/main.rs sauva@192.168.1.6:~/TelemetriaV2.0/telemetry-edge/src/main.rs
```

---

## 11. REFERÊNCIA DE SERVIÇOS SYSTEMD

### Servidor

| Serviço | Arquivo | Função |
|---|---|---|
| `telemetry` | `/etc/systemd/system/telemetry.service` | Servidor principal (TCP+HTTP+WS) |

### Jetson

| Serviço | Arquivo | Função |
|---|---|---|
| `can-interfaces` | `/etc/systemd/system/can-interfaces.service` | Sobe can0, can1, vcan0, vcan1 |
| `can-replay` | `/etc/systemd/system/can-replay.service` | canplayer em loop (simulação) |
| `telemetry-edge` | `/etc/systemd/system/telemetry-edge.service` | Edge — lê CAN, envia ao servidor |

### Ordem de dependência (Jetson)

```
can-interfaces → can-replay → telemetry-edge
```

### Comandos universais

```bash
sudo systemctl status SERVICO
sudo systemctl start SERVICO
sudo systemctl stop SERVICO
sudo systemctl restart SERVICO
sudo systemctl enable SERVICO   # habilitar no boot
sudo systemctl disable SERVICO  # desabilitar no boot
sudo journalctl -u SERVICO -f   # logs em tempo real
sudo systemctl daemon-reload    # após editar arquivo .service
```

---

## PRÓXIMAS VERSÕES

| Versão | Escopo |
|---|---|
| **V2.0** ✅ | Pipeline CAN → Edge → Servidor → Interface Web com JWT |
| **V2.1** | V2.0 + Vídeo ZED 2i (RTSP) + QoS HTB (priorização de banda) |
| **V2.2** | V2.1 + Áudio bidirecional EJEAS Q8 (RTP/Opus) |
| **V2.3** | V2.2 + Segurança (pentests, criptografia, SSH keys, relatórios) |

---

*E-Racing UNICAMP · Telemetria V2.0 · Abril 2026*  
*Em caso de dúvida: copiar mensagem de erro e consultar o Claude*
