# CHECKLIST DE IMPLEMENTAÇÃO — TELEMETRIA V2 · E-RACING ULTRA BLASTER
**Atualizado em 09/06/2026 · Dia 11 — Primeiro teste com carro real · Emergency Stop/Resume · CAN_MAP dinâmico · SQLite WAL no edge · VCU e CMD validados em pista**

---

## Legenda

| OK FEITO DIA 01 | OK FEITO DIA 02 | OK FEITO DIA 03 | OK FEITO DIA 04 | OK FEITO DIA 05 | OK FEITO DIA 06 | OK FEITO DIA 07 | OK FEITO DIA 08 | OK FEITO DIA 09 | OK FEITO DIA 10 | OK FEITO DIA 11 | >> EM ANDAMENTO| XX PENDENTE| NÃO NECESSÁRIO |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| <span style="color:#0047AB;font-weight:bold;">Azul Anil</span> | <span style="color:#006400;font-weight:bold;">Verde Escuro</span> | <span style="color:#87CEEB;font-weight:bold;">Azul Claro</span> | <span style="color:#4169E1;font-weight:bold;">Azul Médio</span> | <span style="color:#800080;font-weight:bold;">Roxo</span> |<span style="color:#D4AF37;font-weight:bold;"> Amarelo </span> | <span style="color:#FF8C00;font-weight:bold;">Laranja</span> | <span style="color:#808080;font-weight:bold;">Cinza</span> | <span style="color:#32CD32;font-weight:bold;">Verde Claro</span> | <span style="color:#1e4620;font-weight:bold;">Verde Musgo</span> | <span style="color:#B8860B;font-weight:bold;">Dourado</span> | <span style="color:#00FF00;font-weight:bold;">Verde</span> | <span style="color:#FF0000;font-weight:bold;">Vermelho</span> | <span style="color:#000000;font-weight:bold;">Preto</span> |

---

## Progresso Geral — Dia 11

| Fase | Feito | Andamento | Pendente | N/A | Status (%) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Fase 1 — Servidor infra** | 19 | 0 | 3 | 0 | **86%** |
| **Fase 2 — Software servidor** | 29 | 0 | 1 | 1 | **97%** |
| **Fase 3 — Edge Jetson** | 31 | 0 | 2 | 2 | **94%** |
| **Fase 4 — Antenas Unifi** | 3 | 0 | 3 | 0 | **50%** |
| **Fase 5 — Teste end-to-end** | 14 | 0 | 2 | 0 | **88%** |
| **Fase 6 — App Android** | 3 | 0 | 7 | 0 | **30%** |
| **Fase 7 — Vídeo + Áudio** | 12 | 2 | 5 | 6 | **60%** |
| **Fase 8 — Segurança** | 4 | 0 | 5 | 0 | **44%** |
| **Melhoria — Acesso Remoto** | 6 | 0 | 2 | 0 | **75%** |
| **NOVO — Dashboard Frontend** | 11 | 0 | 3 | 0 | **79%** |
| **NOVO — Downloads & .ld** | 2 | 1 | 2 | 0 | **60%** |

---

## FASE 1 — INFRAESTRUTURA DO SERVIDOR

### 1.1 Sistema Operacional
| Item | Status | Observação |
| :--- | :---: | :--- |
| Instalar Ubuntu Server 22.04 LTS | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Dual boot com Windows |
| Configurar partição ext4 correta | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Partição NTFS não funciona — refeito como ext4 |
| Atualizar pacotes do sistema | <span style="color:#0047AB;font-weight:bold;">OK FEITO | apt update && apt upgrade |
| Instalar ferramentas essenciais (git, curl, vim...) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | build-essential, pkg-config, libssl-dev |
| Configurar IP fixo via Ethernet (enp1s0) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | 192.168.1.100 via netplan — substituído pela topologia eduroam 143.106.207.21|
| Resolver conflito DNS / internet | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Removido gateway4 do cabo — Wi-Fi assume rota de internet (Bridge) |
| Desabilitar hostapd e dnsmasq |<span style="color:#006400;font-weight:bold;">OK FEITO | Chip Wi-Fi não suporta modo AP — não é necessário |
| Configurar NAT para dar internet à Jetson | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO| iptables MASQUERADE + ip_forward permanente |
| Criar script /etc/eracing/setup-nat.sh | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | Reutilizável — Dia 3 |
| Tornar setup-nat.sh robusto (dongle ausente) | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | Script verifica se WIFI_IFACE existe antes de aplicar — Dia 7 |
| Configurar SSH para acesso remoto na rede local | <span style="color:#800080;font-weight:bold;"> OK FEITO | SSH já funcionava via rede local — Dia 5 |
| Configurar firewall UFW | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Liberar portas 8080, 8081, 8554, 8555, 5600, 5601 — pendente |
| Corrigir arquivo telemetry.service | <span style="color:#800080;font-weight:bold;"> OK FEITO| Description com : e Type=simple corrigidos — Dia 5 |
| Adicionar EnvironmentFile ao telemetry.service | <span style="color:#800080;font-weight:bold;"> OK FEITO | JWT_SECRET carregado pelo systemd — Dia 5 |
| Corrigir RUST_LOG no telemetry.service | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | Corrigido para telemetry_server=info — Dia 6 |
| Corrigir netplan — remover referência a dongle Wi-Fi antigo | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | wlxa86e842b1c75 removido — Dia 7 |
| Configurar internet via cabo eduroam (143.106.207.x) | <span style="color:#808080;font-weight:bold;">OK FEITO  | Gateway 143.106.207.1 — Dia 8 |
| Tornar gateway eduroam permanente no netplan | <span style="color:#32CD32;font-weight:bold;">OK FEITO | IP estático no netplan — resolvido conflito com modem TP-Link — Dia 9 |
| Instalar cloudflared no servidor | <span style="color:#808080;font-weight:bold;">OK FEITO  | v2026.3.0 instalado — Dia 8 |
| Configurar Cloudflare Tunnel (eracing-servidor) | <span style="color:#808080;font-weight:bold;">OK FEITO  | Bloqueado UDP/7844 pela eduroam — Dia 8 |
| Instalar serveo-tunnel.service no servidor | <span style="color:#808080;font-weight:bold;">OK FEITO  | SSH reverso via serveo.net — Dia 8 |
| Adicionar serveo.net no /etc/hosts (bypass DNS UDP) | <span style="color:#808080;font-weight:bold;">OK FEITO  | 5.255.123.12 serveo.net — Dia 8 |
| Adicionar repositórios Ubuntu no /etc/hosts | <span style="color:#808080;font-weight:bold;">OK FEITO  | 91.189.91.81 archive.ubuntu.com — Dia 8 |
| Solicitar liberação de portas ao TI da FEM | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | UDP 7844, TCP 7844, UDP 53, UDP 123 — aguardando |
| Solicitar liberação de MAC do roteador ao TI da FEM | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | MAC 84:16:F9:4A:3F:6A — aguardando |
| Adquirir roteador MikroTik RB5009UG+S+IN | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Aguardando patrocínio — quad-core ARMv8, 802.1X nativo |
| Resolver conflito de IP com modem TP-Link na eduroam | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Modo bridge no modem + IP estático no servidor — MAC Flapping eliminado — Dia 9 |
| Configurar modem em modo bridge (VPI 0/VCI 35) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Modem virou conversor de sinal passivo — servidor assume roteamento — Dia 9 |
| Migrar sistema para HD Toshiba 1TB (WD com setores defeituosos) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | rsync + GRUB + fstab + interface enp4s0f1 — Dia 9 |
| Criar config.env centralizado (/etc/eracing/config.env) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | SERVER_IP, SERVER_UDP_PORT, etc — todos os serviços usam EnvironmentFile — Dia 9 |

### 1.2 Banco de Dados
| Item | Status | Observação |
| :--- | :---: | :--- |
| Instalar SQLite3 | <span style="color:#0047AB;font-weight:bold;">OK FEITO | v3.37.2 instalado |
| Criar banco SQLite de histórico | <span style="color:#0047AB;font-weight:bold;">OK FEITO | data/historico.db criado na inicialização |
| Criar tabelas no SQLite | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Tabela historico com índices — WAL mode |
| Instalar PostgreSQL 14 | <span style="color:#006400;font-weight:bold;">OK FEITO | Instalado e rodando — Dia 2 |
| Instalar extensão TimescaleDB | <span style="color:#006400;font-weight:bold;">OK FEITO | timescaledb-2-postgresql-14 — Dia 2 |
| Criar banco telemetria no PostgreSQL | <span style="color:#006400;font-weight:bold;">OK FEITO | Usuário eracing, senha no .env — Dia 2 |
| Criar hypertable sensor_data | <span style="color:#006400;font-weight:bold;">OK FEITO | Criado automaticamente pelo servidor durante a inicialização |
| Configurar WAL mode no SQLite | <span style="color:#006400;font-weight:bold;">OK FEITO | PRAGMA journal_mode=WAL na inicialização |
| Configurar política de retenção TimescaleDB 7 dias | <span style="color:#006400;font-weight:bold;">OK FEITO | add_retention_policy aplicada — Dia 2 |
| Corrigir arquitetura: remover SQLite do fluxo ao vivo | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | SQLite não recebe mais dados em tempo real — Dia 6 |
| Configurar max_connections(1) no pool SQLite | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | SqlitePoolOptions — Dia 6 |
| Criar índice UNIQUE no SQLite | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | Necessário para INSERT OR IGNORE — Dia 6 |
| Implementar migrate_old_data() com cursor por timestamp | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | O(n log n) via índice — Dia 6 |
| Implementar DELETE por lote após migração | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | Evita re-migração no próximo boot — Dia 6 |
| Adicionar coluna role na tabela users | <span style="color:#1e4620;font-weight:bold;">OK FEITO | ALTER TABLE users ADD COLUMN role — sincronizado com db.rs — Dia 10 |
| Criar tabela telemetry_log_sessions | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Sessões de coleta com timestamps, bounds e state — Dia 10 |
| Resolver SQLite database is locked | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Canal mpsc dedicado + batch writer — zero erros após correção — Dia 10 |
| Migrar 15M registros históricos (TimescaleDB → SQLite) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | 15.567.730 registros migrados em lotes de 5000 — Dia 10 |

### 1.3 Runtime Rust
| Item | Status | Observação |
| :--- | :---: | :--- |
| Instalar Rust toolchain no servidor (rustup) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | v1.93.1 — source ~/.cargo/env |
| Corrigir decoder.rs para formato CSV da E-Racing |<span style="color:#006400;font-weight:bold;">OK FEITO | Implementado parser hierárquico com suporte a bit(X-Y) e byte(X-Y) |
| Compilar telemetry-server | <span style="color:#006400;font-weight:bold;">OK FEITO| Finished release em ~8s — Dia 2 |
| Corrigir main.rs para Dual DB (TimescaleDB + SQLite) | <span style="color:#006400;font-weight:bold;">OK FEITO| Dual write paralelo + .env — Dia 2 |
| Corrigir Cargo.toml do servidor | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Dependências postgres + sqlite + serde_json + dotenvy |
| Testar compilação sem erros | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | Compilação limpa |
| Configurar servidor para iniciar no boot (systemd) | <span style="color:#006400;font-weight:bold;">OK FEITO | /etc/systemd/system/telemetry.service — enabled |
| Configurar .env fora do Git | <span style="color:#006400;font-weight:bold;">OK FEITO | DB_PASSWORD + JWT_SECRET — Dia 2 |

---

## FASE 2 — SOFTWARE DO SERVIDOR (Rust)

### 2.1 Recepção TCP
| Item | Status | Observação |
| :--- | :---: | :--- |
| Listener TCP na porta 8080 | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Implementado e rodando |
| Leitura de frames 24 bytes (len+can_id+ts+data) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Protocolo binário little-endian |
| Validação de payload e proteção contra pacotes ruins | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Limite 1024 bytes, mínimo 20 bytes |
| Identificação do carro por IP de origem | <span style="color:#0047AB;font-weight:bold;">OK FEITO | device_id por IP |
| Suporte a múltiplos carros simultâneos | <span style="color:#0047AB;font-weight:bold;">OK FEITO | tokio::spawn por conexão |
| Log de performance a cada 10 segundos | <span style="color:#0047AB;font-weight:bold;">OK FEITO | frames/s por dispositivo |
| Cálculo e log de latência real por frame | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | info!(Latência CAN) — filtro 0-5000ms — Dia 6 |

### 2.2 Decoder CAN
| Item | Status | Observação |
| :--- | :---: | :--- |
| Carregar CSVs de mapeamento CAN | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Parser hierárquico reescrito — 38 IDs carregados |
| Extração de bits Intel (Little Endian) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | extract_bits() — suporte bit(X), bit(X-Y) |
| Extração de bits Motorola (Big Endian) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | extract_bits_motorola() preservado |
| Aplicar factor e offset ao valor físico | <span style="color:#0047AB;font-weight:bold;">OK FEITO | decode_signal() |
| Suporte a signed integers | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Sign extension implementado |
| Testes unitários do decoder | <span style="color:#0047AB;font-weight:bold;">OK FEITO | 5 testes — bit, byte, range, decode unsigned/signed |
| Carregar DBCs reais (VCU, BMS, Inversores, INS) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Codex CLI atualizou parser DBC — suporte J1939 bit 31 + Motorola + Intel — Dia 10 |
| Remover bit J1939 (bit 31) no lookup de IDs | <span style="color:#1e4620;font-weight:bold;">OK FEITO | id_bus = id_dbc & 0x1FFFFFFF — correto para frame CAN extended — Dia 10 |
| Endpoint GET /api/can-map (serializa DecoderMap) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | src/api/can_map.rs — serializa 342 IDs como JSON para o frontend — Dia 11 |

### 2.3 Persistência e Migração
| Item | Status | Observação |
| :--- | :---: | :--- |
| Salvar em TimescaleDB em paralelo (ao vivo) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | tokio::spawn — não bloqueia TCP |
| Salvar em SQLite histórico em paralelo | <span style="color:#0047AB;font-weight:bold;">OK FEITO | tokio::spawn independente |
| Remover save_sqlite do fluxo ao vivo | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | SQLite não é mais gravado durante telemetria — Dia 6 |
| migrate_old_data() — migração no boot | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | Cursor por timestamp, lotes de 5000 — Dia 6 |
| run_migration_job() periódico | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Removido — migração no boot é suficiente — Dia 6 |
| POST /migrate — rota manual com JWT | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | Para exportar log — Dia 6 |
| Transações em lote para performance | <span style="color:#0047AB;font-weight:bold;">OK FEITO | tx.commit() por batch |
| Tratamento de erro sem derrubar conexão | <span style="color:#0047AB;font-weight:bold;">OK FEITO | error! log, conexão continua |
| Canal mpsc dedicado para escrita SQLite (batch writer) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | ingest.rs: try_send → task dedicada acumula e insere a cada 500 sinais ou 2s — resolve database is locked — Dia 10 |

### 2.4 HTTP + WebSocket + JWT
| Item | Status | Observação |
| :--- | :---: | :--- |
| Servidor HTTP na porta 8081 (GET /) |<span style="color:#800080;font-weight:bold;"> OK FEITO| Serve index.html embutido no binário — Dia 5 |
| Endpoint POST /login com bcrypt + JWT | <span style="color:#800080;font-weight:bold;"> OK FEITO | Autenticação funcional — token 8h — Dia 5 |
| Tabela users no SQLite com password_hash bcrypt | <span style="color:#800080;font-weight:bold;"> OK FEITO| CREATE TABLE users — Dia 5 |
| Servidor WebSocket na porta 8081 (/ws) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | TCP simples, agora binário |
| Autenticação JWT no WebSocket via query string | <span style="color:#800080;font-weight:bold;"> OK FEITO | /ws?token=... — Dia 5 |
| Função extract_query_token() no main.rs | <span style="color:#800080;font-weight:bold;"> OK FEITO | Extrai token da URL — Dia 5 |
| Broadcast para múltiplos clientes simultâneos | <span style="color:#0047AB;font-weight:bold;">OK FEITO | broadcast::channel com buffer 10.000 |
| Proteção contra cliente lento (lagged) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | RecvError::Lagged registrado |
| Formato JSON por sinal decodificado | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Substituído por frames binários 20 bytes — Dia 9 |
| NTP server na porta 9999 | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO  | run_ntp_server() — Dia 6 |
| Rota POST /migrate autenticada | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | Requer JWT válido — Dia 6 |
| Implementar WebSocket protocol real (tokio-tungstenite) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Atual é TCP raw com handshake manual — melhoria futura |
| Migrar broadcast de JSON para frames binários 20 bytes | <span style="color:#32CD32;font-weight:bold;">OK FEITO | can_id(u32) + timestamp(f64) + raw_data(8 bytes) — frontend decodifica no worker — Dia 9 |
| Adicionar serve_static_file() para assets do dashboard | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Serve /assets/*.js, /assets/*.css, /worker.js, /favicon.svg — Dia 9 |
| Embutir dist/index.html no binário (SolidJS) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | include_str! aponta para static/dist/index.html — Dia 9 |
| Endpoint GET /telemetry/logs (listagem de sessões) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | api/logs.rs handle_list_logs — retorna items com status, duração e nome — Dia 10 |
| Endpoint GET /telemetry/logs/:id/download (gerar .ld) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | api/logs.rs handle_download_log — busca TimescaleDB, gera .ld binário — Dia 10 |
| Gerador de arquivo MoTeC .ld (formato binário) | <span style="color:#00FF00;font-weight:bold;">> EM ANDAMENTO| generate_ld_file() em Rust — estrutura por engenharia reversa — test_v3.ld em validação no i2 Pro — Dia 10 |
| Controle de acesso por permissão (logs:read, logs:download) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | auth.rs já tinha as constantes — aplicado em logs.rs — Dia 10 |
| Rota POST /telemetry/collection/start | <span style="color:#1e4620;font-weight:bold;">OK FEITO | api/collection.rs — cria sessão no SQLite com state=active — Dia 10 |
| Rota POST /telemetry/collection/stop | <span style="color:#1e4620;font-weight:bold;">OK FEITO | api/collection.rs — encerra sessão, salva timestamps — Dia 10 |
| Rota POST /telemetry/log-session-bounds | <span style="color:#1e4620;font-weight:bold;">OK FEITO | api/collection.rs — persiste limites reais do log — Dia 10 |
| Rota POST /telemetry/emergency-stop | <span style="color:#B8860B;font-weight:bold;">OK FEITO | api/emergency.rs — envia frame 0x67 [0x00;8] via ws_tx + edge_cmd_tx — restrito a admin — Dia 11 |
| Rota POST /telemetry/emergency-resume | <span style="color:#B8860B;font-weight:bold;">OK FEITO | api/emergency.rs — envia frame 0x67 [0x01,0x00,...] via ws_tx + edge_cmd_tx — restrito a admin — Dia 11 |
| Canal broadcast dedicado edge_cmd_tx | <span style="color:#B8860B;font-weight:bold;">OK FEITO | broadcast::channel(32) separado do ws_tx — ingest.rs assina e escreve no TCP do edge — Dia 11 |
| Split TcpStream no ingest (read_half + write_half) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | into_split() + Arc<Mutex<OwnedWriteHalf>> — task de comandos escreve kills sem interferir no loop de leitura — Dia 11 |

---

## FASE 3 — EDGE (JETSON NO CARRO)

### 3.1 Infraestrutura da Jetson
| Item | Status | Observação |
| :--- | :---: | :--- |
| Leitura via SocketCAN (can0) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Crate socketcan, non-blocking |
| Leitura via Kvaser SDK (feature opcional) | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Jetson tem duas interfaces CAN nativas — dual SocketCAN substitui completamente o Kvaser — Dia 11 |
| Modo simulação de hardware indisponivel | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Removido — sistema roda com can0 e can1 reais do carro — Dia 11 |
| Sistema de prioridade por CSV (VCU=1, BMS=1 ...) | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Removido — CAN_MAP agora vem do servidor via DBC, prioridade não é mais usada no fluxo de envio — Dia 11 |
| Envio de frames em lotes (batch_size=10) | <span style="color:#0047AB;font-weight:bold;">OK FEITO | 24 bytes por frame, little-endian |
| Reconexão automática ao servidor | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Loop infinito com retry a cada 1s |
| Backup local SQLite quando offline | <span style="color:#B8860B;font-weight:bold;">OK FEITO | WAL mode + writer dedicado mpsc — aguenta 2h+ sem conexão — substituiu versão simples — Dia 11 |
| Sincronização dos pendentes ao reconectar | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Até 1000 registros antes de retomar ao vivo |
| Instalar Ubuntu 20.04 na Jetson (JetPack) | **OK FEITO** | Ubuntu 20.04 aarch64 — L4T 35.6.1 |
| Instalar Git na Jetson | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | Instalado — Dia 3 |
| Clonar repositório TelemetriaV2.0 |<span style="color:#87CEEB;font-weight:bold;"> OK FEITO | ~/TelemetriaV2.0 — Dia 3 |
| Dar internet à Jetson via NAT do servidor | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | Rota default via servidor + iptables — Dia 3 |
| Instalar Rust na Jetson (rustup, aarch64) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | v1.94.0 stable-aarch64 — Dia 3 |
| Resolver DNS da Jetson (8.8.8.8 permanente) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | DNSStubListener=no + resolv.conf fixo — Dia 3 |
| Corrigir relógio da Jetson (ntpdate) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | sudo ntpdate -u pool.ntp.org — Dia 3 |
| Configurar rota default permanente na Jetson (dispatcher) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | /etc/NetworkManager/dispatcher.d/99-eracing-route.sh — Dia 3 |
| Configurar IP fixo 192.168.1.101 no eth0 | <span style="color:#FF8C00;font-weight:bold;">OK FEITO| nmcli Profile 1 — Dia 7 |
| Corrigir IP fixo da Jetson (migração para rede eduroam) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Jetson tem IP DHCP variável (143.106.207.x) — precisa reserva DHCP ou IP fixo via TI |
| Corrigir relógio automático no boot da Jetson |<span style="color:#00FF00;font-weight:bold;">> EM ANDAMENTO| Jetson volta ao ano 2000 — NTP UDP bloqueado — script curl HTTP em desenvolvimento — Dia 9 |
| Instalar serveo-tunnel.service na Jetson | <span style="color:#808080;font-weight:bold;">OK FEITO  | SSH reverso via serveo.net — Dia 8 |
| Adicionar serveo.net e gateway no /etc/hosts da Jetson | <span style="color:#808080;font-weight:bold;">OK FEITO  | 5.255.123.12 serveo.net — Dia 8 |
| Carregar módulos CAN no boot (can, can_raw, mttcan) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| /etc/modules — Dia 4 |
| Criar serviço systemd can-interfaces.service | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | Sobe can0 + can1 com bitrate 500000 — Dia 4 |
| Verificar can0 e can1 UP após reboot | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| ip link show can0/can1 — state UP — Dia 4 |
| Adicionar vcan0 e vcan1 ao can-interfaces.service | <span style="color:#800080;font-weight:bold;"> OK FEITO | modprobe vcan + ip link add vcan0/vcan1 — Dia 5 |
| Criar serviço can-replay.service (canplayer em loop) | <span style="color:#800080;font-weight:bold;"> OK FEITO | canplayer -l i -g 1 vcan0=can0 — Dia 5 |
| Criar config.env na Jetson (/etc/eracing/config.env) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | SERVER_IP, SERVER_UDP_PORT etc — todos os serviços usam EnvironmentFile — Dia 9 |
| Adicionar regras udev para câmera ZED | <span style="color:#32CD32;font-weight:bold;">OK FEITO | SUBSYSTEM==usb, ATTRS{idVendor}==2b03, MODE=0666, GROUP=zed — Dia 9 |
| Instalar ZED SDK 4.2.5 na Jetson | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Reinstalado após tentativas com 4.0.8 — compatível com L4T 35.6 — Dia 9 |
| Atualizar SERVER_IP no config.env (rede eduroam) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | SERVER_IP=143.106.207.21 — migração de 192.168.1.100 — Dia 10 |

### 3.2 Software telemetry-edge
| Item | Status | Observação |
| :--- | :---: | :--- |
| Criar FFI próprio para libcanlib.so (kvaser_ffi.rs) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO| extern C + build.rs — Dia 3 |
| Corrigir Cargo.toml (adicionar [package]) | <span style="color:#87CEEB;font-weight:bold;"> OK FEITO | Virtual manifest corrigido — Dia 3 |
| Adicionar import use socketcan::EmbeddedFrame | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| Trait em escopo — Dia 4 |
| Compilar telemetry-edge --release na Jetson | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | Finished release — Dia 4 |
| Testar edge com vcan0 (interface virtual CAN) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| sudo modprobe vcan + canplayer — Dia 4 |
| Reproduzir log CAN real (candump-1999-12-31.log) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | canplayer -l i vcan0=can0 — 16000+ frames — Dia 4 |
| Confirmar frames chegando no TimescaleDB | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | SELECT COUNT(*) — 14135 registros — Dia 4 |
| Confirmar frames chegando no SQLite histórico | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | SELECT COUNT(*) — 11968 registros — Dia 4 |
| Verificar sinais decodificados no banco | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| RPM, TORQUE, VCU_STATE — Dia 4 |
| Criar serviço systemd telemetry-edge.service | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | After=can-interfaces.service — Restart=always — Dia 4 |
| Habilitar telemetry-edge no boot | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | systemctl enable — ativo após reboot — Dia 4 |
| Atualizar telemetry-edge.service para --ch0 vcan0 | <span style="color:#800080;font-weight:bold;"> OK FEITO | Lê vcan0 (simulação) — Dia 5 |
| Adicionar dependência can-replay ao telemetry-edge.service | <span style="color:#800080;font-weight:bold;"> OK FEITO | After + Requires=can-replay.service — Dia 5 |
| Resolver erro No buffer space available no canplayer | <span style="color:#800080;font-weight:bold;"> OK FEITO | ip link set vcan0 txqueuelen 1000 — Dia 5 |
| Implementar measure_clock_offset() no edge | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | SNTP simplificado: 10 amostras, mediana — Dia 6 |
| Adicionar args --ntp_port e --ntp_samples ao CLI | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO| Padrões: 9999 e 10 — Dia 6 |
| Propagar clock_offset para run_socketcan_reader() | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | timestamp = now() + offset — Dia 6 |
| Propagar clock_offset para run_kvaser_reader() | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO| timestamp = now() + offset — Dia 6 |
| Atualizar telemetry-edge.service com EnvironmentFile e bash wrapper | <span style="color:#32CD32;font-weight:bold;">OK FEITO | EnvironmentFile=/etc/eracing/config.env + /bin/bash -c para expansão de variáveis — Dia 9 |
| Testar edge com can0 real (barramento do carro) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | can0 + can1 conectados ao barramento real do veículo — validado em pista — Dia 11 |
| Adicionar DBCs completos ao telemetry-edge | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Edge não usa DBCs — decodificação é feita no servidor. Edge envia frames brutos — Dia 11 |
| Testar can1 (segundo canal CAN via Kvaser) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | can1 via SocketCAN nativo (sem Kvaser) — dual SocketCAN funcional — Dia 11 |
| Validar dados CAN no dashboard SolidJS em tempo real | <span style="color:#1e4620;font-weight:bold;">OK FEITO | 154 sinais distintos confirmados no TimescaleDB — vcells, tcells, TORQUE, IMD, BMS — Dia 10 |
| Confirmar pipeline can-replay → edge → servidor → dashboard | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Replay a 301 frames/s — dashboard mostrando valores — Dia 10 |
| Dual SocketCAN nativo (can0 + can1 simultâneos) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | run_socketcan_reader spawna task independente por interface — Dia 11 |
| SQLite WAL mode + writer dedicado (canal mpsc 100k) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | PRAGMA journal_mode=WAL + synchronous=NORMAL + cache 64MB — flush 500 frames ou 2s — Dia 11 |
| Receber comandos do servidor pelo mesmo TCP (split) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | into_split() — task lê read_half, loop de envio usa write_half via Arc<Mutex<>> — Dia 11 |
| Emergency stop no barramento CAN (0x67 extended, payload 0x00) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | ExtendedId(0x67) + [0x00;8] enviado em can0 e can1 — motor desligou em teste real — Dia 11 |
| Emergency resume no barramento CAN (0x67 extended, payload 0x01) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | ExtendedId(0x67) + [0x01,0x00,...] — carro religou via dashboard — Dia 11 |
| Autocura Bus-Off (restart-ms 100 no can-interfaces.service) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | ip link set can0 type can bitrate 500000 restart-ms 100 — kernel reinicia controladora CAN automaticamente — Dia 11 |
| Corrigir relógio automático no boot da Jetson | <span style="color:#B8860B;font-weight:bold;">OK FEITO | Chrony configurado seguindo servidor como mestre — NTP UDP da aplicação desativado — Dia 11 |
| Rede permanente na Jetson (gateway + resolv) | <span style="color:#B8860B;font-weight:bold;">OK FEITO | Script NetworkManager reescrito + resolv.conf bloqueado com chattr +i — Dia 11 |
| Limpar código edge (CSV, Kvaser, priority map, unsafe) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Remover load_priority_map, kvaser_fii.rs, campo priority, RECV_COUNT unsafe — pendente |


---

## FASE 4 — REDE SEM FIO (ANTENAS UNIFI)

| Item | Status | Observação |
| :--- | :---: | :--- |
| Adquirir par de antenas Unifi UAP-AC-M | <span style="color:#0047AB;font-weight:bold;">OK FEITO | Hardware presente — par instalado |
| Configurar antena base como Access Point | <span style="color:#800080;font-weight:bold;"> OK FEITO | Antena preta na base |
| Configurar antena carro como Station | <span style="color:#800080;font-weight:bold;"> OK FEITO | Antena laranja na Jetson |
| Verificar RSSI > -65dBm no painel Unifi | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Teste de sinal em campo ainda não realizado |
| Testar alcance na pista (carro em movimento) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Confirmar link estável em toda a pista |
| Configurar WMM 802.11e nas antenas | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | UDP :5004/:5005 → VO, TCP :8080 → VI — planejado V2.3 |
| Tornar a rede das antenas uma bridge da principal | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Atualmente temos duas redes, uma gerida pelo servidor outra comunicação das antenas |

---

## FASE 5 — TESTE END-TO-END

| Item | Status | Observação |
| :--- | :---: | :--- |
| Servidor rodando e banco inicializado | <span style="color:#006400;font-weight:bold;"> OK FEITO| systemd garante início automático — Dia 2 |
| Edge conectando ao servidor via rede (bancada Wi-Fi) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | Conectado via hotspot celular — Dia 4 |
| Edge conectando ao servidor via cabo (rede E-Racing) | <span style="color:#800080;font-weight:bold;"> OK FEITO | IP 192.168.1.100:8080 — Dia 5 |
| Edge conectando ao servidor via Wi-Fi Unifi | <span style="color:#800080;font-weight:bold;"> OK FEITO | Antenas UAP-AC-M ponto-a-ponto — Dia 5 |
| Frames CAN chegando no servidor (TimescaleDB) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO| 14135 registros confirmados — Dia 4 |
| Frames CAN salvos no histórico (SQLite) | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | 11968 registros confirmados — Dia 4 |
| Contador de registros crescendo em tempo real | <span style="color:#4169E1;font-weight:bold;"> OK FEITO | watch -n 1 psql — Dia 4 |
| Interface web abrindo em http://IP:8081 | <span style="color:#800080;font-weight:bold;"> OK FEITO| Login JWT + dashboard em tempo real — Dia 5 |
| Dashboard exibindo sinais CAN decodificados | <span style="color:#800080;font-weight:bold;"> OK FEITO | Tabela atualizada via WebSocket — Dia 5 |
| Teste de resiliência — reboot completo | <span style="color:#800080;font-weight:bold;"> OK FEITO | Servidor + Jetson: 2min 35s — Dia 5 |
| Teste de resiliência — reboot só Jetson | <span style="color:#800080;font-weight:bold;"> OK FEITO | 51 segundos até dados na interface — Dia 5 |
| Latência real medida e validada | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | 3.77ms média, 451ms máxima — 100.000 amostras — Dia 6 |
| Migração de dados históricos validada | <span style="color:#D4AF37;font-weight:bold;"> OK FEITO | 2.118.301 registros migrados — Dia 6 |
| Dashboard SolidJS em produção no servidor | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Build gerado, servido pelo servidor Rust — Dia 9 |
| Frames binários chegando ao worker do frontend | <span style="color:#32CD32;font-weight:bold;">OK FEITO | can_id + timestamp + raw_data — decodificados em tempo real — Dia 9 |
| Edge conectando via rede eduroam (143.106.207.x) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | SERVER_IP atualizado — 301 frames/s confirmados — Dia 10 |
| App Android recebendo via WebSocket :8081 | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Depende de implementação do app |
| Testar queda e recuperação de Wi-Fi | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Derrubar antena → esperar backup → reconectar |
| Validar arquivo .ld gerado no MoTeC i2 Pro | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | test_v3.ld gerado — aguardando validação no i2 Pro — Dia 10 |
|Testar reconexão real(desligar servidor e voltar) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Teste de campo necessário |
| Testar candump com dados reais | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Confirmar IDs do barramento batem com .dbc |
| Configurar can0 e can1 para subir no boot | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | /etc/network/interfaces.d/can0 && /etc/network/interfaces.d/can0 |

---

## FASE 6 — APP ANDROID

### 6.1 Conexão e Dados
| Item | Status | Observação |
| :--- | :---: | :--- |
| Conectar ao WebSocket :8081 do servidor | <span style="color:#32CD32;font-weight:bold;">OK FEITO | Dashboard web (Chromium) conectado — app Android pendente |
| Parsear frames binários recebidos (20 bytes) | <span style="color:#32CD32;font-weight:bold;">OK FEITO | worker.js decodifica via DataView — Dia 9 |
| Exibir sinais em tempo real (dashboard) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | StatusBar mostrando vcells, tcells, TORQUE, BMS — Dia 10 |
| Consultar histórico via REST API | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | API REST ainda não implementada no servidor |
| Autenticação de usuário | <span style="color:#800080;font-weight:bold;"> OK FEITO | Tabela users + bcrypt + JWT — Dia 5 |
| Modo offline (cache local no app) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Para quando Wi-Fi cair no pit lane |

### 6.2 API REST no Servidor
| Item | Status | Observação |
| :--- | :---: | :--- |
| Endpoint GET /sinais/recentes | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Últimos N registros do TimescaleDB |
| Endpoint GET /sinais/historico?de=&ate= | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Query no SQLite por período |
| Endpoint GET /sinais/estatisticas | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | AVG, MIN, MAX por sinal |
| Endpoint POST /auth/login | <span style="color:#800080;font-weight:bold;"> OK FEITO  | Já implementado — retorna JWT — Dia 5 |
| Implementar servidor HTTP completo (porta 8082) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE | Usar axum ou actix-web para REST |
| Endpoint GET /telemetry/logs | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Lista sessões com status, duração, nome — Dia 10 |
| Endpoint GET /telemetry/logs/:id/download | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Download .ld do período da sessão — Dia 10 |

## FASE 7 — VÍDEO E COMUNICAÇÃO COM PILOTO

### 7.1 Streaming de Vídeo
| Item | Status | Observação |
| :--- | :---: | :--- |
| Adquirir câmera ZED 2i Stereo (Stereolabs) | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | Hardware presente — S/N 2183, firmware 1523 — Dia 7 |
| Instalar ZED SDK 4.x na Jetson | <span style="color:#1e4620;font-weight:bold;">OK FEITO| SDK 4.2.5 reinstalado e funcional para ZED original — Dia 9 |
| Instalar plugin zed-gstreamer (Stereolabs oficial) | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | ZED SDK não suporta PID f880 (ZED 2i nova) nem SN2183 sem calibração real — V4L2 é a solução — Dia 9 |
| Testar pipeline GStreamer: zedsrc → nvh264enc | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO| zedsrc depende do SDK incompatível — substituído por v4l2src — Dia 7 |
| Instalar GStreamer na Jetson | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | gstreamer1.0-tools, plugins-good, plugins-bad, plugins-ugly — Dia 7 |
| Acessar câmera via V4L2 (/dev/video0) | <span style="color:#FF8C00;font-weight:bold;">OK FEITO| v4l2src io-mode=2 — formato YUY2 — 2560x720@60fps — Dia 7 |
| Configurar pipeline GStreamer H264 UDP |<span style="color:#FF8C00;font-weight:bold;">OK FEITO | v4l2src → videoconvert → videocrop → x264enc → rtph264pay → udpsink — Dia 7 |
| Streaming câmera esquerda para PC via UDP | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | videocrop right=1280 — 1280x720@60fps — Dia 7 |
| Streaming ambas câmeras para PC via UDP | <span style="color:#FF8C00;font-weight:bold;">OK FEITO | Sem videocrop — 2560x720@60fps — Dia 7 |
| Ativar encoder NVENC (nvv4l2h264enc) via V4L2 |<span style="color:#1e4620;font-weight:bold;">OK FEITO| v4l2src → nvvidconv → NV12(NVMM) → nvv4l2h264enc — NVENC ativo mas FPS baixo com rtspclientsink — Dia 9 |
| Criar serviço systemd zed-stream.service | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Pipeline GStreamer automático no boot — After=network.target — Restart=always — Dia 9 |
| Configurar relay RTSP na porta :8554 | <span style="color:#1e4620;font-weight:bold;">OK FEITO | gst-rtsp-server Python + mediamtx — Dia 9 |
| Criar serviço video-backup.service | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Grava MKV de 5min em /var/eracing/video/ — Dia 9 |
| Criar serviço mediamtx.service (WebRTC) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | WebRTC :8555 — mediamtx v1.11.3 — Dia 9 |
| Criar serviço udp-to-rtsp.service (ffmpeg) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | Converte UDP RTP → RTSP → mediamtx — Dia 9 |
| Configurar QoS HTB (3 classes) | <span style="color:#1e4620;font-weight:bold;">OK FEITO | setup_qos.sh + eracing-qos.service em servidor e Jetson — Dia 9 |
| Receber e exibir stream no Chromium via WebRTC | <span style="color:#1e4620;font-weight:bold;">OK FEITO | http://IP:8555/cam — imagem visível — FPS baixo a resolver — Dia 9 |
| Resolver problema de FPS baixo (~6fps) | <span style="color:#00FF00;font-weight:bold;">> EM ANDAMENTO| NVENC + udpsink tem gargalo — investigar com x264enc e buffer_size maior — Dia 9 |
| Integrar vídeo no cockpit do dashboard (RaceVideoPanel) | <span style="color:#00FF00;font-weight:bold;">> EM ANDAMENTO| RaceVideoPanel.jsx pronto — falta passar URL WebRTC para o Cockpit.jsx — Dia 9 |
| Receber e exibir stream no app Android | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| ExoPlayer ou LibVLC — rtsp://IP:8554/stream |
| Instalar câmera IP 1080p no carro [ORIGINAL] | <span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO| Substituído pela ZED — planejamento V2.1 |
| Investigar SDK ZED 5.x com Jetson Orin para percepção futura | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Xavier AGX incompatível com SDK 5.x — requer Orin + JetPack 6 |

---

## 7.2 Comunicação com Piloto

| Item | Status | Observação |
| :--- | :---: | :--- |
| Adquirir kit EJEAS Q8 (2 unidades, Mesh 3.0, IP67) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| ~R$1.750 — substitui WebRTC — full-duplex via Mesh 3.0 2.4GHz |
| Mapear pinos USB-C do Q8 (multímetro) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Identificar GND, VBUS, L, R, MIC |
| Montar circuito USB-C breakout + TRRS P2 | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Resistores CC1/CC2 5.1kΩ |
| Conectar Q8 base ao Jetson via adaptador DAC USB-C | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Verificar arecord -l e aplay -l após conexão |
| Implementar crate telemetry-audio-edge (Rust) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| ALSA via cpal → encode Opus → UDP/RTP :5004 |
| Implementar crate telemetry-audio-srv (Rust) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| UDP/RTP :5004/:5005 → relay WebSocket + backup .opus |
| Testar comunicação full-duplex piloto ↔ engenheiro | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Latência alvo ~51–75ms |





## FASE 8 — SEGURANÇA E PRODUÇÃO
| Item | Status | Observação |
|--------|--------|------------|
| Autenticação JWT no WebSocket |<span style="color:#800080;font-weight:bold;"> OK FEITO | JWT via query string — Dia 5 |
| Senha bcrypt no banco de usuários | <span style="color:#800080;font-weight:bold;"> OK FEITO | password_hash nunca em plain text — Dia 5 |
| .env fora do Git | <span style="color:#006400;font-weight:bold;"> OK FEITO | DB_PASSWORD + JWT_SECRET — .gitignore — Dia 2 |
| HTTPS no servidor (certificado TLS) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Necessário antes de exposição pública |
| Rate limiting no endpoint /login | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Prevenção de brute force |
| Rotação automática de tokens JWT | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Token expira em 8h — refresh token não implementado |
| Firewall UFW configurado | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Liberar apenas portas necessárias |
| Validação de origem das conexões TCP (edge) | <span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Aceitar apenas IPs conhecidos no :8080 |
| Autenticação JWT com validação no servidor | OK FEITO | Token validado em /ws e /migrate |

## MELHORIAS FUTURAS (ALÉM DO ESCOPO INICIAL)

### Melhoria 1 — Unifi em Modo PtP Bridge
Atualmente as antenas Unifi operam em modo AP + Station. Configurar como Point-to-Point Bridge elimina o overhead de Wi-Fi gerenciado pelo roteador, reduzindo a latência no trecho sem fio de ~5ms para ~2ms. As antenas funcionam como um cabo virtual transparente.
| Item | Status | Observação |
|--------|--------|------------|
| Reconfigurar antenas Unifi como PtP Bridge | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Painel Unifi → Bridge Mode. Roteador continua como gateway. |
| Validar latência após mudança (alvo < 3ms Wi-Fi) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| ping -c 100 192.168.1.101 — medir avg e jitter |

### Melhoria 2 — Eliminar o Roteador (Rede Dedicada)
Se o servidor tiver duas interfaces de rede, é possível criar uma sub-rede dedicada apenas para telemetria (192.168.2.x), sem passar pelo roteador. O servidor vira o gateway da rede do carro, com controle total de QoS e firewall.
| Item | Status | Observação |
|--------|--------|------------|
| Verificar se servidor tem segunda interface de rede | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| ip link show — buscar enp2s0 ou similar |
| Configurar sub-rede 192.168.2.0/24 no servidor | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Netplan enp2s0: addresses: 192.168.2.1/24 |
| Ligar enp2s0 direto na antena Unifi base | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Cabo Cat6 do servidor → Antena base |
| Reconfigurar Jetson para 192.168.2.101 | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Isola completamente tráfego de telemetria |

### Melhoria 3 — QoS (quando tiver vídeo + áudio + telemetria juntos)
Quando os três protocolos estiverem ativos, configurar prioridade de tráfego garante que mesmo se o vídeo saturar a rede, a telemetria e o áudio são processados primeiro. Com a topologia atual (100+ Mbit/s disponíveis vs ~8.5 Mbit/s usados), isso só é crítico em situações de sinal Wi-Fi fraco.
| Item | Status | Observação |
|--------|--------|------------|
| Instalar iprote2 para tc (traffic control) | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| sudo apt install iproute2 |
| Configurar fila de prioridade por porta | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Porta 8080 (telemetria) > 5004 (áudio) > 8554 (vídeo)|
| Validar que telemetria não perde frames com vídeo ativo | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Teste de carga simultânea |

### Melhoria 4 — WebSocket Real (tokio-tungstenite)
O WebSocket atual é TCP raw com JSON por linha — funciona, mas não é o protocolo WebSocket padrão (RFC 6455). Para compatibilidade com browsers e bibliotecas padrão do Android, adicionar o handshake HTTP/WebSocket real.
| Item | Status | Observação |
|--------|--------|------------|
| Adicionar tokio-tungstenite ao Cargo.toml | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| tokio-tungstenite = { version = "0.21", features = ["native-tls"] } |
| Substituir TCP raw por WebSocket upgrade | <span style="color:#FF0000;font-weight:bold;"><span style="color:#FF0000;font-weight:bold;">XX PENDENTE| Compatível com qualquer lib WebSocket do Android |


## ITENS DO PLANO ORIGINAL QUE NÃO SÃO NECESSÁRIOS
**Os itens abaixo estavam no checklist original mas foram descartados com base na topologia de rede real e nas decisões técnicas tomadas durante a implementação.**
| Item | Status | Observação |
|--------|--------|------------|
| hostapd (Access Point Wi-Fi no servidor) |<span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Chip Wi-Fi não suporta modo AP. Rede feita via Unifi. |
| dnsmasq (DHCP server no servidor) |<span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Roteador já faz o DHCP |
| Mosquitto / MQTT Integration |<span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Todo o serviddor é Rust. Python não é usado no servidor |
| Raspberry Pi como base station |<span style="color:#000000;font-weight:bold;">NÃO NECESSÁRIO | Usando servidor com Ubuntu Server jáa instalado. |

E-Racing Ultra Blaster · Telemetria V2 · 01/03/2026