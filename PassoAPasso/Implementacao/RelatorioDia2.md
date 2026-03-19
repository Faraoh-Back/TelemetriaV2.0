# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 07 de Março de 2026  
**Status:** Servidor totalmente funcional — pronto para integração com Jetson

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Verificação do estado do servidor (retomada após dias parado)
        ↓ IP fixo 192.168.1.100 — OK
        ↓ SQLite instalado — OK
        ↓ Rust instalado — OK
        ↓ Código presente via Git (Faraoh-Back/TelemetriaV2.0)
        ↓ PostgreSQL — NÃO instalado
        ↓ Servidor — NÃO compilado
        ↓ Nenhuma porta em uso

2. Diagnóstico e correção de rede
        ↓ Problema: sem internet no servidor
        ↓ Causa: netplan tinha gateway4 no cabo (enp1s0)
                 que não tem internet — conflito com Wi-Fi
        ↓ Solução: remover gateway4 do cabo no netplan
                   Wi-Fi (wlx00e12907f625) assume o gateway via DHCP
        ↓ Resultado: cabo = rede interna 192.168.1.x ✅
                     Wi-Fi = internet ✅

3. Instalação PostgreSQL + TimescaleDB
        ↓ PostgreSQL 14 instalado com sucesso
        ↓ TimescaleDB instalado (aviso apt-key deprecated — inofensivo)
        ↓ timescaledb-tune executado (otimizações automáticas)
        ↓ Banco 'telemetria' criado com usuário 'eracing'
        ↓ Problema: senha digitada com aspas duplas quebrou SQL na 1ª tentativa
        ↓ Solução: reexecutar com aspas simples — CREATE ROLE + CREATE DATABASE ✅

4. Verificação dos arquivos no repositório Git
        ↓ Pasta: ~/TelemetriaV2.0/telemetry-server
        ↓ main.rs: versão Dual DB (TimescaleDB + SQLite) — correto ✅
        ↓ decoder.rs: presente ✅
        ↓ Cargo.toml: presente ✅
        ↓ csv_data/CAN Description 2025 - VCU.csv: presente ✅

5. Primeira tentativa de compilação
        ↓ Erro: URL do PostgreSQL usava 'postgres' como usuário
                mas criamos o usuário 'eracing'
        ↓ Erro: borrow/ownership no tokio::spawn (processed_c movido duas vezes)
        ↓ Erro: variável mut desnecessária (ws_rx)
        ↓ Correções aplicadas via Git (PC → push → git pull no servidor)
        ↓ Resultado: Finished release in 8.15s ✅

6. Primeira execução — erro no CSV
        ↓ Problema: decoder.rs esperava CSV com cabeçalho padrão
                    mas o CSV real tem formato hierárquico próprio:
                    "Grupo", 0xCANID  ← linha de grupo
                    , sinal, bit(0-1) ← linha de sinal
        ↓ Solução: reescrita completa do decoder.rs
                   Parser customizado para o formato da E-Racing
                   Suporte a bit(X), bit(X-Y), byte(X), byte(X-Y)
        ↓ Resultado: 14 CAN IDs carregados do CSV ✅

7. Introdução de variáveis de ambiente (.env)
        ↓ Problema: senha do banco estava hardcoded na URL do PostgreSQL
        ↓ Decisão: usar arquivo .env com DB_PASSWORD
        ↓ Mudanças: adicionar dotenvy ao Cargo.toml
                    criar função get_pg_url() que lê env var
                    dotenvy::dotenv().ok() no início do main
        ↓ Erro: .connect(&get_pg_url()) — tipo errado (fn vs &str)
        ↓ Correção: let pg_url = get_pg_url(); .connect(&pg_url)
        ↓ Resultado: compilação OK ✅

8. Erros de múltiplos comandos SQL no mesmo query
        ↓ Problema: sqlx não aceita múltiplos comandos em um prepared statement
                    init_sqlite() tinha CREATE TABLE + 3x CREATE INDEX juntos
                    init_timescale() tinha 2x CREATE INDEX juntos
        ↓ Solução: separar cada comando em sqlx::query() independente
        ↓ Resultado: servidor inicializado completamente ✅

9. Servidor rodando com sucesso
        ↓ 14 CAN IDs carregados do CSV ✅
        ↓ TimescaleDB inicializado (tempo real, retenção 7 dias) ✅
        ↓ SQLite inicializado (histórico persistente) ✅
        ↓ TCP listener em 0.0.0.0:8080 ✅
        ↓ WebSocket em 0.0.0.0:8081 ✅
        ↓ Servidor pronto! ✅

10. Configuração do servidor como serviço (systemd)
        ↓ Objetivo: servidor sobe automaticamente no boot
        ↓ Criado /etc/systemd/system/telemetry.service
        ↓ Problema: typo 'Typle' em vez de 'Type' no .service
        ↓ Problema: caminho do .env incorreto (estava em src/, movido para raiz)
        ↓ Problema: porta 8081 em uso por processo anterior (Ctrl+Z suspende, não mata)
        ↓ Solução portas: sudo kill -9 $(lsof -ti:8080) && $(lsof -ti:8081)
        ↓ Status: serviço configurado e ativo no boot ✅
```

---

## PARTE 2 — DECISÕES TÉCNICAS IMPORTANTES

### Por que reescrevemos o decoder.rs

O CSV da E-Racing tem um formato hierárquico próprio, não um CSV tabular padrão. A primeira versão do decoder usava `serde::Deserialize` para mapear colunas com nomes fixos (`Signal Name`, `Start Bit`, etc.) — isso funciona para CSVs com cabeçalho padrão, mas não para o formato real que é:

```
"Nome do grupo", 0xCANID, 8B, type, min, max, multiplier, offset, unit
, nome_sinal, bit(0-1), int, 0, 3, 1, 0, state
, outro_sinal, byte(4-5), float, -100, 100, 0.1, -100, km/h
(linha vazia = fim do grupo)
```

A nova versão faz parsing manual linha a linha, identificando linhas de grupo pelo CAN ID no segundo campo, e linhas de sinal pela primeira coluna vazia.

### Por que usamos .env com dotenvy

Senhas hardcoded no código-fonte são um problema de segurança e de manutenção — qualquer pessoa com acesso ao Git vê a senha. Com `.env`:
- Arquivo fica **fora do Git** (`.gitignore`)
- Cada ambiente (servidor de corrida, servidor de desenvolvimento) pode ter sua própria senha
- Fácil de mudar sem recompilar

### Por que separamos cada sqlx::query()

O PostgreSQL e o SQLite via sqlx não aceitam múltiplos comandos SQL em um único prepared statement. Cada `CREATE TABLE`, `CREATE INDEX`, `PRAGMA` precisa ser um `sqlx::query()` separado. Essa é uma limitação do driver, não do banco.

---

## PARTE 3 — ARQUITETURA ATUAL DO SERVIDOR

```
.env (DB_PASSWORD=...)
      ↓
telemetry-server (Rust, porta 8080 TCP + 8081 WebSocket)
      ↓ lê
csv_data/CAN Description 2025 - VCU.csv
      ↓ decoder.rs
      ├── 14 CAN IDs mapeados
      ├── Suporte bit(X), bit(X-Y), byte(X), byte(X-Y)
      └── Factor + Offset aplicados

Conexões de entrada (porta 8080):
      Edge (Jetson) ──Wi-Fi Unifi──→ TCP:8080
      Protocolo: 4B(len) + 4B(can_id) + 8B(timestamp) + 8B(data)

Persistência (paralela, tokio::spawn):
      ├── TimescaleDB → sensor_data (tempo real, 7 dias)
      └── SQLite → historico (permanente)

Saída (porta 8081):
      WebSocket JSON → App Android (futuro)
```

---

## PARTE 4 — STATUS ATUAL DO PROJETO V2

### O que está FEITO ✅

| Componente | Status | Observação |
|---|---|---|
| Ubuntu Server instalado | ✅ | Dual boot com Windows |
| Rede configurada | ✅ | Cabo = 192.168.1.100, Wi-Fi = internet |
| PostgreSQL 14 instalado | ✅ | Banco 'telemetria', usuário 'eracing' |
| TimescaleDB instalado | ✅ | Hypertable sensor_data, retenção 7 dias |
| SQLite instalado | ✅ | historico.db em data/ |
| Rust instalado | ✅ | v1.93.1 |
| decoder.rs reescrito | ✅ | Parser para formato CSV da E-Racing |
| server/main.rs | ✅ | Dual DB + WebSocket + .env |
| Compilação do servidor | ✅ | Finished release in ~8s |
| Servidor rodando | ✅ | TCP:8080 + WS:8081 + ambos os bancos |
| Serviço systemd | ✅ | Sobe no boot automaticamente |
| .gitignore para .env | ✅ | Senha nunca vai para o Git |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Edge no Jetson | 🔴 Alta | Compilar e rodar telemetry-edge amanhã |
| Interface CAN (can0) | 🔴 Alta | Subir no Jetson e testar com candump |
| Teste end-to-end | 🔴 Alta | Jetson → Wi-Fi Unifi → Servidor → bancos |
| Configurar antenas Unifi | 🟡 Média | Modo AP + Station, SSID eracing_telemetry |
| App Android | 🟡 Média | Consome WebSocket :8081 |
| API REST no servidor | 🟡 Média | Para consultas do app Android |
| UFW (firewall) | 🟢 Baixa | Liberar 8080 e 8081 |
| Vídeo RTSP | 🟢 Baixa | GStreamer no Jetson |
| Áudio WebRTC | 🟢 Baixa | Comunicação com piloto |

---

## PARTE 5 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### Ctrl+Z vs Ctrl+C no terminal

`Ctrl+Z` **suspende** o processo (fica em background parado, ainda ocupa a porta).  
`Ctrl+C` **encerra** o processo (libera a porta).

Para matar processos suspensos que travaram portas:
```bash
sudo kill -9 $(sudo lsof -ti:8080) 2>/dev/null
sudo kill -9 $(sudo lsof -ti:8081) 2>/dev/null
# ou
pkill -9 -f telemetry-server
```

### Fluxo correto de deploy com Git

```
PC (edita código) → git commit + push
Servidor          → git pull + cargo build --release
```

Nunca editar arquivos diretamente no servidor — sempre via Git para manter histórico e consistência.

### systemd — erros comuns

| Erro | Causa | Solução |
|---|---|---|
| status=203/EXEC | Caminho do binário errado | Verificar ExecStart com ls |
| status=1/FAILURE | Programa crasha | Rodar direto no terminal para ver erro |
| Porta em uso | Processo anterior não foi morto | pkill -9 -f telemetry-server |

---

## PARTE 6 — PRÓXIMOS PASSOS (DIA 3)

### Amanhã — Jetson AGX Xavier

```
1. Ligar Jetson e conectar cabo na antena Unifi (Station)
2. Configurar IP fixo no Jetson (192.168.1.101)
3. Testar ping 192.168.1.100 (servidor)
4. Subir interface CAN: ip link set can0 type can bitrate 500000
5. Testar candump can0 (confirmar dados do barramento)
6. Compilar telemetry-edge: cargo build --release
7. Rodar edge e verificar conexão ao servidor
8. Verificar dados chegando no TimescaleDB:
   psql -U eracing -d telemetria -h localhost -c "SELECT COUNT(*) FROM sensor_data;"
9. Verificar dados chegando no SQLite:
   sqlite3 ~/TelemetriaV2.0/telemetry-server/data/historico.db "SELECT COUNT(*) FROM historico;"
```

### Configuração das antenas Unifi (pode fazer amanhã também)

```
Antena base → Mode: Access Point, SSID: eracing_telemetry, 5GHz
Antena carro → Mode: Station, conectar no SSID da base
Verificar RSSI > -65dBm no painel Unifi
```

---

*Documento gerado em 07/03/2026 — E-Racing Ultra Blaster Telemetria V2*
