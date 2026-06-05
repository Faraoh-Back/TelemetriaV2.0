# RELATÓRIO GERAL — TELEMETRIA V2 E-RACING ULTRA BLASTER

**Data:** 05 de Junho de 2026
**Status:** Pipeline completo funcional — dashboard recebendo dados, aba de Downloads operacional, gerador .ld em validação

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Diagnóstico e correção do banco de dados (SQLite)
        ↓ Problema: tabela 'users' sem coluna 'role'
        ↓ Problema: tabela 'telemetry_log_sessions' inexistente
        ↓ Solução: ALTER TABLE + CREATE TABLE manuais via sqlite3
        ↓ Resultado: schema alinhado com o db.rs ✅

2. Diagnóstico e correção do problema de SQLite travado
        ↓ Problema: logs mostravam 'database is locked' e 'PoolTimedOut'
        ↓ Causa: versão antiga do binário fazia tokio::spawn por frame CAN
                 pool SQLite com 1 conexão + 250 frames/s = deadlock garantido
        ↓ Solução: canal mpsc dedicado ao SQLite com batch writer
                   ingest.rs manda sinais via try_send (não bloqueia)
                   task separada acumula e insere a cada 500 sinais ou 2s
        ↓ Resultado: zero erros de SQLite nos logs ✅

3. Conexão da Jetson ao novo servidor
        ↓ Rede mudou de 192.168.1.x para 143.106.207.x (rede UNICAMP)
        ↓ Atualização do SERVER_IP no /etc/eracing/config.env da Jetson
        ↓ Subida dos serviços na Jetson: can-interfaces → can-replay → telemetry-edge
        ↓ Confirmação de conexão TCP estável (ESTAB na porta 8080) ✅

4. Diagnóstico de por que o dashboard não mostrava dados
        ↓ Login e WebSocket funcionavam (101 Switching Protocols)
        ↓ Problema identificado: CAN_MAP do worker.js tinha IDs errados
        ↓ IDs no banco: 419368426, 419368695, 431292423, 259...
        ↓ IDs no worker: 0x18FF00EA, 0x18FF01EA... (nunca chegam do carro)
        ↓ Causa raiz: DBC mudou, decoder.rs atualizado, worker.js não
        ↓ Descoberta adicional: worker.js em public/ é diferente do src/workers/
                   o Vite não processa public/, apenas copia
        ↓ Solução: editar public/worker.js diretamente + npm run build + cp
        ↓ Resultado: vcells, tcells, TORQUE aparecendo no dashboard ✅

5. Alinhamento de nomes de sinais entre banco e dashboard
        ↓ Banco tem 'RPM 0A' (com espaço), worker manda 'RPM_0A' (underscore)
        ↓ dashboardConfig.js usava nomes antigos: act_Speed_A0, Fault_IMD...
        ↓ Solução: atualizar dashboardConfig.js com nomes reais do banco
        ↓ Resultado: cards da StatusBar mostrando valores ✅

6. Sessão de coleta travada no banco
        ↓ Botão "Iniciar Coleta" retornava "Já existe uma coleta em andamento"
        ↓ Causa: sessão id=1 ficou com state='active' de teste anterior
        ↓ Solução: UPDATE via sqlite3 forçando state='stopped'
        ↓ Resultado: novas coletas funcionando normalmente ✅

7. Implementação da aba de Downloads (backend)
        ↓ Frontend chamava GET /telemetry/logs → 404 Not Found
        ↓ Causa: endpoint não existia no mod.rs (documentado como pendente)
        ↓ Criado: src/api/logs.rs com handle_list_logs e handle_download_log
        ↓ mod.rs atualizado: rota /download antes de /logs (ordem importa)
        ↓ auth.rs já tinha PERMISSION_LOGS_READ e PERMISSION_LOGS_DOWNLOAD ✅
        ↓ Resultado: aba Downloads mostra sessões com status e duração ✅

8. Implementação do gerador de arquivos MoTeC .ld
        ↓ Fase 1: gerador ingênuo com magic 'LDMOTEC\0' — rejeitado pelo i2
        ↓ Fase 2: engenharia reversa do arquivo real 20200930-0364202_1.ld
                   mapeamento byte a byte do header, session block, canal descriptors
        ↓ Problema descoberto: SESSION_SIZE estava 0x190 mas devia ser 0x01C0
                   venue (offset +0x15E) overflow → corrompeu todos os offsets
        ↓ Problema descoberto: campo 0x42 do session block era 0x4240, não 0x4042
                   bytes invertidos geravam campo inválido
        ↓ Problema descoberto: event_offset e FIRST_CHAN_OFF estavam errados
                   causava canal descriptors em offset incorreto
        ↓ Fase 3: usar template real do bloco de sessão (0x40..0xBF)
                   copiar 128 bytes do arquivo real, substituir apenas campos de texto
                   garante campos desconhecidos corretos
        ↓ Resultado: test_v3.ld gerado com estrutura correta — em validação no i2 ⏳

9. Conversa com Codex CLI — atualização do decoder.rs para DBC completo
        ↓ Objetivo: decoder.rs ler todos os DBCs e salvar sinais com nomes corretos
        ↓ Codex atualizou o parser de DBC para lidar com IDs J1939 (bit 31)
        ↓ Codex atualizou mapeamento de sinais Motorola e Intel byte order
        ↓ Resultado: banco de dados com sinais nomeados corretamente do DBC ✅
        ↓ Pendente: worker.js (CAN_MAP do frontend) não foi atualizado pelo Codex ❌
```

---

## PARTE 2 — DECISÕES TÉCNICAS IMPORTANTES

### Por que o SQLite travava com 'database is locked'

O SQLite é um banco de dados que usa um mecanismo de lock em nível de arquivo. Quando uma transação de escrita está aberta, nenhuma outra pode começar. O problema era arquitetural:

O `ingest.rs` antigo fazia um `tokio::spawn` por frame CAN recebido, cada um tentando escrever no SQLite individualmente. Com 250 frames/s e ~12 sinais por frame, isso gerava ~3000 tasks assíncronas por segundo concorrendo pela única conexão do pool (configurado com `max_connections(1)`).

```
Frame CAN chega → tokio::spawn → save_sqlite() → BEGIN TRANSACTION
Frame CAN chega → tokio::spawn → save_sqlite() → espera lock...
Frame CAN chega → tokio::spawn → save_sqlite() → espera lock...
... (3000 tasks empilhadas)
→ PoolTimedOut (aguardou conexão por > 10s)
→ database is locked (tentou forçar sem conseguir)
```

A solução foi o padrão **producer-consumer com canal mpsc**:

```
ingest.rs: try_send(sinais) → canal (buffer 50k) → task dedicada → batch INSERT
```

O `try_send` nunca bloqueia: se o canal estiver cheio descarta silenciosamente. A task dedicada acumula sinais e insere em lote a cada 500 sinais ou 2 segundos, garantindo que o SQLite receba uma única transação por vez com centenas de INSERTs juntos — muito mais eficiente.

### Por que o CAN_MAP do worker estava com IDs errados

O protocolo J1939 (usado em veículos pesados e Formula Student) atribui IDs CAN de 29 bits com estrutura específica. O bit 31 é um flag que indica Extended Frame Format. Os IDs nos DBCs são armazenados com esse bit setado:

```
DBC: BO_ 2566849002 MOBILE1_Actvals_DCUA
ID com bit 31: 0x98FF01EA
ID no barramento: 0x18FF01EA (remove bit 31 = 0x80000000)
```

O worker tinha os IDs corretos do inversor público (`0x18FF01EA`), mas o carro passou a transmitir os sinais de setpoint (`0x18FF0DEA`, decimal 419368426) e não mais os de actval. O banco de dados é a fonte da verdade: os IDs que aparecem no TimescaleDB são os que realmente chegam.

### Por que o Vite não processa o worker.js

O Vite tem dois diretórios com comportamentos distintos:

- `src/`: processado pelo bundler — transpilação, tree-shaking, hash de nome, minificação
- `public/`: copiado literalmente para `dist/` — sem processamento

O `worker.js` está em `public/` porque um Web Worker precisa de uma URL fixa para ser instanciado (`new Worker('/worker.js')`). Se estivesse em `src/`, o Vite geraria um nome com hash como `worker-CdhQaMoD.js`, quebrando a referência estática. O preço é que edições em `src/workers/worker.js` não têm efeito — o arquivo que importa é `public/worker.js`.

### Estrutura do formato MoTeC .ld

O formato `.ld` não é documentado oficialmente pela MoTeC. Todo conhecimento disponível vem de engenharia reversa por projetos open-source como `gotzl/ldparser`. A estrutura real confirmada:

```
0x0000: Header (64 bytes)
  first_chan_offset → aponta para session block
  event_offset     → aponta para event block (primeiro canal real)
  last_chan_offset  → offset do último canal na linked list

0x0040: Session Block (128 bytes)
  campos de metadados: tipo de dispositivo, data, hora, piloto, veículo, venue

0x00C0: Event Block (128 bytes)
  prev = 0
  next → primeiro canal de dados
  last → último canal de dados

0x0140..: Canal Descriptors (128 bytes cada, linked list)
  prev_chan / next_chan / data_offset / n_samples
  dtype = 0x0003 (f32 little-endian)
  freq_hz
  name (32 bytes) / short_name (8 bytes) / unit (12 bytes)
  max_val / min_val

após todos os descritores: Data Blocks
  sequência de f32 LE, um bloco contíguo por canal
```

O campo `dtype = 0x0003` indica que os dados são `float32` diretamente, sem escala complexa. Isso simplifica o gerador: os valores físicos do banco são escritos diretamente como f32 sem conversão adicional.

### Por que usar template do arquivo real no session block

Os campos `0x42..0x61` do session block têm valores desconhecidos que variam por versão de firmware do dispositivo MoTeC. Tentativas de usar valores fixos inventados resultaram em rejeição silenciosa pelo i2 Pro (`Failed to load log file`). A solução foi copiar os primeiros 128 bytes do bloco de sessão de um arquivo `.ld` real e substituir apenas os campos de texto conhecidos (data, hora, piloto, veículo, venue). Isso garante que os campos de versão, device type e outros metadados internos estejam em valores que o i2 reconhece como válidos.

---

## PARTE 3 — ARQUITETURA ATUAL DO SISTEMA

```
Jetson AGX Xavier (143.106.207.93)
  can-interfaces.service    → sobe vcan0, vcan1, can0, can1
  can-replay.service        → canplayer lê .log e injeta em vcan0
  telemetry-edge.service    → lê vcan0, decodifica via DBC, envia TCP
        ↓ TCP :8080 (frames binários: 4B len + 4B can_id + 8B ts + 8B data)

Servidor Ubuntu (143.106.207.21)
  telemetry.service (Rust)
    ingest.rs               → recebe frames TCP, decodifica, distribui
    db.rs/save_timescale()  → TimescaleDB (tempo real, 7 dias)
    db.rs/save_sqlite()     → SQLite via canal mpsc (histórico persistente)
    ws.rs                   → broadcast WebSocket :8081
    api/logs.rs             → GET /telemetry/logs (lista sessões)
                            → GET /telemetry/logs/:id/download (gera .ld)

Browser (Dashboard)
  worker.js (Web Worker)    → recebe frames binários via WebSocket
                            → decodifica com CAN_MAP (O(1) lookup por can_id)
                            → CircularBuffer por sinal (3900 amostras)
                            → postMessage para SolidJS store
  StatusBar                 → cards de valor instantâneo (PINNED_SIGNALS)
  MotecChart                → gráficos uPlot com LTTB
  DownloadsPage             → lista sessões, download .ld
```

---

## PARTE 4 — STATUS ATUAL DO PROJETO V2

### O que está FEITO ✅

| Componente | Status | Observação |
|---|---|---|
| Backend Rust compilando | ✅ | v2.2, sem erros |
| TimescaleDB recebendo dados | ✅ | 154 sinais distintos no banco |
| SQLite sem travamento | ✅ | Canal mpsc + batch writer |
| Jetson conectada via rede UNICAMP | ✅ | 143.106.207.93 → .21 |
| WebSocket funcionando | ✅ | 101 Switching Protocols |
| Dashboard mostrando tensões de célula | ✅ | vcell_0..vcell_95 |
| Dashboard mostrando temperaturas de célula | ✅ | tcell_0..tcell_31 |
| Dashboard mostrando torque dos motores | ✅ | TORQUE_13A, TORQUE_13B |
| Aba de Downloads listando sessões | ✅ | GET /telemetry/logs |
| Download de arquivo .ld | ✅ | gerador em validação |
| Migração de dados antigos | ✅ | 15M registros movidos para SQLite |
| Decoder usando DBCs reais | ✅ | Codex atualizou o parser |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Validar test_v3.ld no i2 Pro | 🔴 Alta | Testar se o i2 aceita e mostra dados corretos |
| Atualizar CAN_MAP do worker.js | 🔴 Alta | Codex atualizou o decoder.rs mas não o frontend |
| Verificar nomes dos sinais pós-Codex | 🔴 Alta | Banco pode ter nomes diferentes agora |
| dashboardConfig.js com RPM | 🟡 Média | RPM e torque não aparecem nos cards ainda |
| Sessão 11 travada como 'active' | 🟡 Média | Precisa de UPDATE manual ou endpoint de limpeza |
| Favicon 404 | 🟢 Baixa | /favicon.ico não servido pelo servidor |
| team-logo.png 404 | 🟢 Baixa | Asset não copiado para static/dist/assets/ |

---

## PARTE 5 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### O arquivo que o Vite não processa

Editar `src/workers/worker.js` e rodar `npm run build` não tem efeito algum no arquivo servido. O arquivo que importa é `public/worker.js`. O processo correto é:

```bash
# 1. Editar public/worker.js diretamente
# 2. Rodar o build
npm run build
# 3. O Vite copia public/worker.js para dist/worker.js automaticamente
# 4. Confirmar que as mudanças chegaram
grep -c "419368426" dist/worker.js
```

### Ordem das rotas no mod.rs

No roteador manual do servidor, a comparação de rotas é por `starts_with`. Se `/telemetry/logs` vem antes de `/telemetry/logs/:id/download`, **todas** as requisições de download caem na rota de listagem porque `/telemetry/logs/42/download` também começa com `/telemetry/logs`. A rota mais específica deve vir primeiro:

```rust
// CORRETO: mais específico primeiro
} else if first_line.starts_with("GET /telemetry/logs") && first_line.contains("/download") {
    logs::handle_download_log(...)
} else if first_line.starts_with("GET /telemetry/logs") {
    logs::handle_list_logs(...)
```

### IDs J1939 vs IDs no barramento CAN

DBCs de veículos J1939 armazenam IDs com o bit 31 setado como flag de extended frame:

```
ID no DBC:        0x98FF01EA (bit 31 = 1)
ID no barramento: 0x18FF01EA (bit 31 = 0)
Operação:         id_bus = id_dbc & 0x1FFFFFFF
```

O decoder.rs e o CAN_MAP do worker devem usar o ID do barramento (sem o bit 31). Para identificar quais IDs realmente chegam, a fonte mais confiável é o TimescaleDB:

```sql
SELECT DISTINCT can_id, signal_name FROM sensor_data ORDER BY can_id;
```

---

## PARTE 6 — O QUE O CODEX CLI FEZ (e o que ficou pendente)

### Contexto

Em paralelo à sessão de hoje, o Codex CLI (GPT-4.1 da OpenAI em modo agente) foi acionado para trabalhar no `decoder.rs` do servidor Rust, com o objetivo de melhorar o parser de DBC e garantir que os sinais fossem salvos no banco com os nomes e valores corretos conforme os arquivos `.dbc` reais do carro.

### O que o Codex fez ✅

O Codex modificou o `decoder.rs` para:

1. **Suporte completo a IDs J1939**: remove corretamente o bit 31 dos IDs do DBC antes de fazer o lookup, garantindo que `0x98FF01EA` no DBC seja tratado como `0x18FF01EA` no barramento.

2. **Byte order Motorola**: implementou extração de bits MSB-first para sinais Motorola (BMS usa este formato), além do Intel/LSB-first já existente.

3. **Parser DBC mais robusto**: lida com comentários, linhas em branco, e variações de formatação nos arquivos `.dbc` reais.

4. **Nomes de sinais do DBC**: os sinais agora são salvos no banco com os nomes exatos do DBC (ex: `Cell_module_Overheat`, `Discharge_over_current`) em vez de nomes genéricos.

### O que o Codex NÃO fez ❌

**O CAN_MAP do `public/worker.js` não foi atualizado.**

O Codex trabalhou apenas no backend (Rust). O frontend (JavaScript) que decodifica os frames CAN no browser também tem seu próprio mapa de sinais no `public/worker.js`. Esse mapa precisa ser mantido sincronizado com o que o decoder.rs produz.

**Impacto atual**: após o trabalho do Codex, os nomes dos sinais no banco podem ter mudado. Por exemplo, o que era `'RPM 0A'` pode agora ser `'act_Speed_A0'` ou outro nome vindo do DBC. Se os nomes mudaram, o CAN_MAP do worker.js precisa ser atualizado para refletir os novos nomes, e o `dashboardConfig.js` também.

**O que precisa ser feito:**

```bash
# 1. Verificar os nomes atuais no banco após trabalho do Codex
psql -U eracing -d telemetria -h localhost -c "
SELECT DISTINCT signal_name, can_id FROM sensor_data ORDER BY can_id, signal_name;"

# 2. Comparar com o CAN_MAP atual do worker.js
grep "n: '" ~/TelemetriaV2.0/telemetry-server/static/public/worker.js | head -20

# 3. Atualizar o CAN_MAP com os nomes corretos do banco
# 4. Atualizar o dashboardConfig.js com os novos nomes
# 5. Rebuild do frontend
cd ~/TelemetriaV2.0/telemetry-server/static
npm run build
```

---

## PARTE 7 — PRÓXIMOS PASSOS (DIA 11)

### Imediato

```
1. Testar test_v3.ld no i2 Pro
   → Abrir o arquivo e verificar se os 3 canais (RPM_0A, APS_PERC, vcell_0) aparecem
   → Se aparecer mas com valores errados: ajustar dec_pl ou escala
   → Se rejeitar: comparar header byte a byte com arquivo real novamente

2. Verificar nomes dos sinais pós-Codex
   → Rodar query no TimescaleDB
   → Comparar com CAN_MAP do worker.js
   → Identificar divergências

3. Atualizar CAN_MAP do worker.js
   → Alinhar com nomes reais do banco
   → Manter suporte Motorola/Intel no canDecode.js (já implementado)
   → Rebuild e testar no dashboard
```

### Curto prazo

```
4. Se test_v3.ld for aprovado no i2:
   → Substituir generate_ld_file() no logs.rs pelo código Python validado
   → Push + cargo build --release no servidor
   → Testar download de sessão real pelo dashboard

5. Atualizar dashboardConfig.js
   → PINNED_SIGNALS com nomes corretos pós-Codex
   → GAUGE_CONFIG com RPM reais
   → DEFAULT_CHART_LAYOUT com sinais disponíveis
```

### Médio prazo

```
6. Limpar sessões antigas com state='active' indevidamente
7. Endpoint de limpeza de sessões travadas
8. Testar com carro real (não replay) quando disponível
9. Verificar campos de tempo relativo no .ld (o i2 usa tempo relativo ao início da sessão)
```

---

## PARTE 8 — CONCEITOS USADOS HOJE

| Conceito | Aplicação |
|---|---|
| **mpsc channel (multi-producer, single-consumer)** | Resolver contention no SQLite: N tasks de ingest → 1 task de escrita |
| **tokio::select!** | Aguardar canal mpsc OU tick de timer para flush do batch SQLite |
| **Linked list de canais** | Estrutura do formato .ld: cada canal tem prev/next apontando para o vizinho |
| **J1939 Extended Frame** | IDs CAN de 29 bits com bit 31 como flag — remover para lookup no barramento |
| **Motorola vs Intel byte order** | BMS usa MSB-first (Motorola), inversores usam LSB-first (Intel) |
| **Engenharia reversa binária** | Mapeamento byte a byte do formato .ld usando xxd + Python struct |
| **Template de arquivo binário** | Copiar campos desconhecidos de arquivo real em vez de inventar valores |
| **Web Worker isolamento** | WebSocket em thread separada para não bloquear render do browser |
| **Vite public/ vs src/** | Arquivos estáticos com URL fixa vs bundles processados com hash |
| **WAL mode SQLite** | Write-Ahead Logging — permite leituras concorrentes durante escrita |

---

*Documento gerado em 05/06/2026 — E-Racing Ultra Blaster Telemetria V2*
