# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 03 de Abril de 2026  
**Status:** TelemetriaV2.0 — Pipeline completo funcional, interface web operante

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Diagnóstico completo da topologia de rede
        ↓ Jetson (192.168.1.6) → UAP-AC-M → UAP-AC-M → Roteador → Servidor (192.168.1.100)
        ↓ Notebook (192.168.1.4) conectado ao roteador via cabo
        ↓ Servidor com Wi-Fi (10.199.34.44) como gateway de internet
        ↓ Jetson usando servidor como gateway NAT (rota default via 192.168.1.100)
        ↓ Notebook sem internet pelo cabo (roteador sem WAN) — resolvido via Wi-Fi

2. Interface web — autenticação JWT
        ↓ Servidor iniciou com erro: porta 8081 em uso (serviço systemd rodando)
        ↓ Solução: sudo systemctl stop telemetry
        ↓ Servidor subiu manualmente com sucesso
        ↓ Login funcionou — JWT gerado corretamente
        ↓ Problema: WebSocket rejeitado (sem token) após login

3. Diagnóstico e correção do WebSocket
        ↓ Causa: browsers bloqueiam headers customizados no WebSocket (limitação RFC)
        ↓ Frontend mandava token no primeiro frame — servidor rejeitava no handshake HTTP
        ↓ Solução: token na query string da URL (/ws?token=eyJ...)
        ↓ Mudança no main.rs: função extract_query_token() + fallback para Bearer header
        ↓ Mudança no index.html: WebSocket URL com token via encodeURIComponent
        ↓ Resultado: 📱 WS conectado ✅

4. Deploy das correções
        ↓ Problema: rede da oficina bloqueando porta 22 (SSH) e 443 (HTTPS) para GitHub
        ↓ Problema: typo na URL do remote (TelemetriaV2.0.gi em vez de .git)
        ↓ Solução: hotspot celular + git remote set-url corrigido
        ↓ Push realizado — git pull no servidor

5. Problemas com processos duplicados
        ↓ Dois processos telemetry-server rodando simultaneamente
        ↓ Um pelo systemd (binário antigo), um manual (binário novo)
        ↓ Logs aparecendo sem rodar — processo background herdado da sessão SSH
        ↓ Solução: pkill -f telemetry-server + systemctl stop telemetry antes de qualquer start

6. Correção do serviço systemd do servidor
        ↓ Problema: Description: com ':' em vez de '='
        ↓ Problema: Type=simpĺe com caractere especial 'ĺ'
        ↓ Problema: EnvironmentFile ausente → JWT_SECRET não carregado → crash no boot
        ↓ Solução: nano + correção manual + daemon-reload
        ↓ Resultado: serviço estável no boot ✅

7. Jetson — configuração do pipeline de dados
        ↓ telemetry-edge rodando como serviço mas enviando dados sintéticos (kvaser_ch0_sim)
        ↓ Causa: can0 é interface física — sem barramento real, frames não têm ACK
        ↓ candump can0 retornava vazio: barramento físico sem nó respondendo
        ↓ Solução: usar vcan0 (interface CAN virtual do kernel)
        ↓ canplayer com '-l i' saturava buffer: erro "No buffer space available"
        ↓ Solução: txqueuelen 1000 + flag -g 1 (gap de 1ms entre frames)
        ↓ Resultado: candump vcan0 mostrando frames reais ✅

8. Edge lendo vcan0 com dados reais
        ↓ Serviço atualizado: --ch0 vcan0
        ↓ Log mudou de Canal=kvaser_ch0_sim para Canal=vcan0
        ↓ IDs reais chegando: 19B50800, 19B50000, 18FF1515, etc.
        ↓ Servidor recebendo e decodificando
        ↓ Interface web exibindo dados em tempo real ✅

9. Automação completa no boot
        ↓ can-interfaces.service: adicionado modprobe vcan + vcan0 + vcan1
        ↓ can-replay.service: canplayer em loop injetando log nos dois vcan
        ↓ telemetry-edge.service: atualizado para depender do can-replay
        ↓ Problema: --ch1 vcan1 inválido — argumento espera número (canal Kvaser)
        ↓ Solução: --ch1 0 mantido — can1 real só com hardware Kvaser
        ↓ Resultado: boot completo sem intervenção manual ✅

10. Teste de resiliência (reboot)
        ↓ Reboot simultâneo servidor + Jetson: 2min 35s até dados na interface
        ↓ Reboot só da Jetson (cenário real de corrida): 51 segundos
        ↓ Pipeline completo funcionando automaticamente ✅
```

---

## PARTE 2 — CONCEITOS TÉCNICOS IMPORTANTES

### Por que browsers não permitem headers customizados no WebSocket

O protocolo WebSocket (RFC 6455) inicia com um handshake HTTP. O browser envia uma requisição como esta:

```
GET /ws HTTP/1.1
Host: 192.168.1.100:8081
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
```

A especificação proíbe que JavaScript adicione headers customizados neste momento por segurança — especificamente para prevenir ataques CSRF (Cross-Site Request Forgery). Se fosse possível adicionar `Authorization: Bearer ...`, um site malicioso poderia fazer seu browser conectar no WebSocket de outro site usando suas credenciais sem você saber.

A solução padrão da indústria é passar o token na query string:

```
GET /ws?token=eyJhbGciOiJIUzI1NiJ9... HTTP/1.1
```

Isso é legível pelo servidor no handshake antes de qualquer frame ser trocado, e é o padrão usado por Slack, Discord, e praticamente todos os sistemas WebSocket com autenticação em browser.

### Como o handshake WebSocket funciona (RFC 6455)

O servidor implementado na TelemetriaV2.0 faz o handshake do zero, sem biblioteca externa. O processo é:

```
1. Browser → Servidor: HTTP GET /ws?token=... com header Upgrade: websocket
                        + Sec-WebSocket-Key: <base64 de 16 bytes aleatórios>

2. Servidor verifica token JWT na query string

3. Servidor calcula o accept key:
   accept = base64(SHA1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
   (o GUID fixo é definido pela RFC 6455)

4. Servidor → Browser: HTTP 101 Switching Protocols
                        + Sec-WebSocket-Accept: <accept calculado>

5. Conexão upgradada — agora é protocolo binário WebSocket
   Frames têm: opcode (text/binary/ping/pong/close) + payload length + mask + dados
```

O SHA1 e o base64 estão implementados manualmente no `main.rs` para evitar dependências externas.

### Por que o bcrypt é seguro mesmo o algoritmo sendo público

O bcrypt não protege por obscuridade — o algoritmo é completamente público. A proteção é o **custo computacional intencional**:

```
Custo 12 → 2^12 = 4096 iterações internas
Tempo para calcular 1 hash: ~100ms

Para um atacante testar 1.000.000 de senhas:
  - 1.000.000 × 100ms = ~28 horas por máquina
  - Com 10 máquinas GPU: ainda ~3 horas
  - Senha aleatória de 12+ chars: anos mesmo com cluster

Para o usuário legítimo:
  - 1 hash no login = 100ms → imperceptível
```

Além disso, o **salt aleatório** (22 chars no hash) garante que dois usuários com a mesma senha têm hashes completamente diferentes, invalidando ataques com rainbow tables (dicionários pré-computados).

### Por que o CAN físico precisa de ACK

O barramento CAN foi projetado para ambientes automotivos onde múltiplos nós estão sempre presentes. Quando um nó transmite um frame, **todos os outros nós** devem confirmar o recebimento enviando um bit de ACK durante a transmissão. Se ninguém confirmar, o transmissor detecta erro e retrasmite indefinidamente, preenchendo o buffer — daí o `No buffer space available`.

Com `vcan0` (interface virtual do kernel), o próprio kernel faz o ACK automaticamente, permitindo injeção de frames sem hardware real.

### JWT — estrutura e funcionamento

```
eyJhbGciOiJIUzI1NiJ9  .  eyJzdWIiOiJlcmFjaW5nIiwiaWF0IjoxNzQzNjQxMjM1fQ  .  assinatura
        │                                    │                                      │
   Header (base64)                    Payload (base64)                   HMAC-SHA256
   {"alg":"HS256"}           {"sub":"eracing","iat":...,"exp":...}    (JWT_SECRET)
```

O servidor valida a assinatura com o `JWT_SECRET` do `.env`. Se o token for adulterado (qualquer bit diferente), a assinatura não bate e o acesso é negado. O token expira em 8 horas (configurável em `JWT_EXPIRY_HOURS`).

---

## PARTE 3 — ARQUITETURA FINAL DA V2.0

```
BOOT AUTOMÁTICO — JETSON
  systemd: can-interfaces.service
    └── modprobe can, can_raw, mttcan, vcan
    └── ip link set can0/can1 type can bitrate 500000 → UP
    └── ip link add vcan0/vcan1 type vcan → UP
    └── ip link set vcan0/vcan1 txqueuelen 1000

  systemd: can-replay.service  (After: can-interfaces)
    └── canplayer -I candump.log -l i -g 1 vcan0=can0  (loop)
    └── canplayer -I candump.log -l i -g 1 vcan1=can0  (loop)

  systemd: telemetry-edge.service  (After: can-replay)
    └── telemetry-edge --ch0 vcan0 --ch1 0 --server 192.168.1.100:8080

BOOT AUTOMÁTICO — SERVIDOR
  systemd: telemetry.service  (After: postgresql)
    └── EnvironmentFile: .env (DB_PASSWORD + JWT_SECRET)
    └── telemetry-server
          ├── Carrega CSVs (38 CAN IDs)
          ├── Conecta TimescaleDB + SQLite
          ├── TCP :8080 → recebe frames CAN do edge
          ├── Decodifica sinais (decoder.rs)
          ├── Persiste em paralelo (TimescaleDB + SQLite)
          └── HTTP+WS :8081
                ├── GET /       → index.html (embutido no binário)
                ├── POST /login → valida bcrypt → emite JWT
                └── GET /ws?token=... → valida JWT → broadcast JSON

BROWSER (qualquer dispositivo na rede 192.168.1.x)
  http://192.168.1.100:8081
    └── Login → JWT salvo no localStorage
    └── WebSocket ws://192.168.1.100:8081/ws?token=...
    └── Dashboard em tempo real — tabela de sinais CAN decodificados
```

---

## PARTE 4 — GUIA DE EXECUÇÃO NA OFICINA (preservado do guia_oficina_telemetria_v21)

### Etapa 1 — Atualizar e compilar (quando houver mudança de código)

```bash
cd ~/TelemetriaV2.0/telemetry-server
git pull
cargo build --release 2>&1 | tee /tmp/build.log
```

**Erros comuns de compilação:**

| Mensagem | O que fazer |
|---|---|
| `error: failed to select a version for bcrypt` | Editar Cargo.toml: `bcrypt = "0.14"` |
| `include_str! file not found` | Verificar: `ls static/index.html` |
| `linker error: cannot find -lssl` | `sudo apt install libssl-dev pkg-config` |

### Etapa 2 — Configurar ambiente (.env)

```bash
# Verificar se existe
cat .env
# Deve conter:
# DB_PASSWORD=...
# JWT_SECRET=...

# Gerar JWT_SECRET se necessário
python3 -c "import secrets; print(secrets.token_hex(32))"
echo 'JWT_SECRET=VALOR_AQUI' >> .env
```

### Etapa 3 — Criar usuário no banco

```bash
# Gerar hash bcrypt da senha
python3 -c "import bcrypt; print(bcrypt.hashpw(b'minha_senha', bcrypt.gensalt()).decode())"

# Inserir no banco (tudo em uma linha)
sqlite3 ./data/historico.db "INSERT INTO users (username, password_hash) VALUES ('eracing', 'HASH_AQUI');"

# Verificar
sqlite3 ./data/historico.db "SELECT id, username, created_at FROM users;"
```

### Etapa 4 — Subir o servidor

```bash
# Parar qualquer processo anterior
sudo systemctl stop telemetry
pkill -f telemetry-server

# Pelo systemd (produção)
sudo systemctl start telemetry
sudo journalctl -u telemetry -f

# Manual (debug)
./target/release/telemetry-server
```

**Saída esperada:**
```
🚀 Telemetry Server v2.1 — Dual DB + JWT Auth
✅ 38 CAN IDs carregados do CSV
✅ TimescaleDB inicializado
✅ SQLite inicializado
📡 TCP CAN listener em 0.0.0.0:8080
🌐 HTTP+WS server em 0.0.0.0:8081
✅ Servidor pronto!
```

### Etapa 5 — Testar interface web

```
http://192.168.1.100:8081
```

| Verificação | Resultado esperado |
|---|---|
| Abrir URL | Tela de login |
| Login com credenciais erradas | "Credenciais inválidas" em vermelho |
| Login correto | Dashboard |
| Badge WebSocket | "conectado" em verde |
| Fechar e reabrir browser | Vai direto ao dashboard (token salvo) |
| Botão Sair | Volta ao login |

### Etapa 6 — Testar com dados reais (Jetson)

```bash
# Na Jetson — verificar serviços
sudo systemctl status can-interfaces
sudo systemctl status can-replay
sudo systemctl status telemetry-edge

# Ver dados chegando no vcan0
candump vcan0 | head -10

# Ver logs do edge
sudo journalctl -u telemetry-edge -f
```

### Referência rápida — comandos do dia a dia

| Ação | Comando |
|---|---|
| Ver logs do servidor | `sudo journalctl -u telemetry -f` |
| Reiniciar servidor | `sudo systemctl restart telemetry` |
| Ver logs do edge | `sudo journalctl -u telemetry-edge -f` |
| Ver dados no banco (tempo real) | `watch -n 1 'PGPASSWORD=SENHA psql -U eracing -d telemetria -h localhost -t -c "SELECT COUNT(*) FROM sensor_data;"'` |
| Matar processos nas portas | `sudo kill -9 $(sudo lsof -ti:8080 -ti:8081) 2>/dev/null` |
| Invalidar todos os tokens | Trocar JWT_SECRET no .env + restart |
| Adicionar usuário | `python3 -c "import bcrypt; ..."` + sqlite3 INSERT |
| Listar usuários | `sqlite3 ./data/historico.db "SELECT id, username FROM users;"` |

---

## PARTE 5 — RELATÓRIO DE PERFORMANCE

### 5.1 Latência de rede

| Rota | Min | Média | Max | Desvio padrão | Perda |
|---|---|---|---|---|---|
| Notebook → Servidor (cabo) | 0.756ms | 0.966ms | 1.230ms | 0.113ms | 0% |
| Notebook → Jetson (cabo+Unifi) | 1.581ms | 2.479ms | 5.227ms | 0.853ms | 0% |
| Jetson → Servidor (caminho real) | 0.823ms | 1.567ms | 3.835ms | 0.584ms | 0% |

**Metodologia:** `ping -c 100` em cada rota, resultado da linha `rtt min/avg/max/mdev`.

**Análise:** O caminho real dos dados (Jetson → Servidor) tem média de **1.57ms** e desvio padrão de **0.58ms**, indicando rede estável e consistente. A meta de < 5ms para telemetria em tempo real é amplamente atingida.

### 5.2 Latência do pipeline ponta a ponta

**Metodologia:** `EXTRACT(EPOCH FROM (NOW() - time)) * 1000` nos registros mais recentes do TimescaleDB (janela de 5 segundos).

| Métrica | Valor |
|---|---|
| Mínimo (melhor caso) | 128ms |
| Média | ~2.400ms |
| Máximo | ~5.000ms |
| Desvio padrão | ~1.400ms |

**Observação importante:** A média e o desvio alto são causados pelo `-g 1` do canplayer (gap artificial de 1ms entre frames) e pela natureza do log replay — frames com timestamps originais de 1999 são reinjetados em sequência, criando janelas de tempo irregulares. O valor representativo da latência real do pipeline é o **mínimo: ~128ms**, que corresponde ao frame mais recente inserido no banco.

Com o barramento CAN real do carro (sem canplayer), a latência ponta a ponta esperada é:

```
CAN read (~1ms) + TCP send (~1ms) + DB insert (~5-10ms) + WS broadcast (~1ms) ≈ 10-15ms
```

### 5.3 Throughput

| Métrica | Valor |
|---|---|
| Frames enviados (sessão de teste) | 740.000+ |
| Taxa de envio | ~1.000 frames / 11s ≈ 90 frames/s |
| Registros no TimescaleDB (Dia 4) | 14.135 |
| Registros no SQLite (Dia 4) | 11.968 |
| CAN IDs mapeados | 38 (7 CSVs) |
| Backup SQLite no edge | 14 registros (frames sem conexão) |

### 5.4 Resiliência e tempo de recuperação

| Cenário | Tempo até dados na interface web |
|---|---|
| Reboot completo (servidor + Jetson) | 2min 35s |
| Reboot só da Jetson (cenário de corrida) | **51 segundos** |

**Análise:** O reboot duplo é dominado pelo tempo de inicialização do PostgreSQL no servidor (~90s). O cenário real de corrida é o reboot só da Jetson — **51 segundos** é excelente para um sistema embarcado com boot completo do Linux + CAN + pipeline de telemetria.

### 5.5 Topologia de rede medida

```
192.168.1.x (sub-rede interna)
├── 192.168.1.1   → Roteador (DHCP, sem internet)
├── 192.168.1.4   → Notebook (cabo ao roteador)
├── 192.168.1.6   → Jetson AGX Xavier (eth0, IP via DHCP)
└── 192.168.1.100 → Servidor Ubuntu (enp1s0, IP fixo netplan)
                    └── wlx... → 10.199.34.44 (Wi-Fi, internet + NAT para Jetson)
```

---

## PARTE 6 — STATUS FINAL DO PROJETO

### TelemetriaV2.0 — COMPLETA ✅

| Componente | Status |
|---|---|
| Servidor Ubuntu 22.04 | ✅ IP fixo 192.168.1.100 |
| PostgreSQL 14 + TimescaleDB | ✅ Banco telemetria, retenção 7 dias |
| SQLite histórico | ✅ data/historico.db |
| Rust telemetry-server | ✅ TCP:8080 + HTTP/WS:8081 + JWT |
| Decoder CAN (38 IDs, 7 CSVs) | ✅ bit/byte, factor, offset, signed |
| Interface web | ✅ Login JWT + dashboard tempo real |
| WebSocket autenticado | ✅ Token via query string |
| systemd telemetry.service | ✅ Boot automático com .env |
| Jetson AGX Xavier | ✅ Ubuntu 20.04 aarch64 |
| SocketCAN (can0, can1) | ✅ Bitrate 500kbps, boot automático |
| vcan0/vcan1 (simulação) | ✅ Boot automático |
| can-replay.service | ✅ canplayer em loop no boot |
| telemetry-edge | ✅ Rust aarch64, systemd, --ch0 vcan0 |
| NAT Jetson → internet | ✅ Via servidor (iptables MASQUERADE) |
| Antenas Unifi UAP-AC-M | ✅ Ponto-a-ponto Jetson ↔ Servidor |

### Pendente para V2.1

| Item | Descrição |
|---|---|
| Vídeo ZED 2i Stereo | GStreamer + RTSP :8554 |
| QoS HTB | 3 classes: telemetria > áudio > vídeo |
| can1 real | Requer hardware Kvaser conectado |
| UFW firewall | Portas 8080 e 8081 |
| CSVs adicionais | BMS, PT, PAINEL com Prio < 4 |
| Rede dedicada | Eliminar roteador, servidor como gateway |

---

*Documento gerado em 03/04/2026 — E-Racing Ultra Blaster Telemetria V2*
