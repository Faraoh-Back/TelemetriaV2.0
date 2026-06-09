# RELATÓRIO GERAL — TELEMETRIA V2.2 E-RACING ULTRA BLASTER

**Data:** 09 de Junho de 2026
**Status:** Primeiro teste com carro real — VCU validada, CAN bidirecional funcional, sistema completo end-to-end

---

## PARTE 1 — O QUE FIZEMOS HOJE

### Linha do tempo do que foi executado

```
1. Implementação do Emergency Stop (botão de matar o carro)
        ↓ Diagnóstico: botão existia no frontend mas rota não chegava ao edge
        ↓ Causa raiz: emergency.rs fazia broadcast no ws_tx (canal WebSocket)
                      edge conecta via TCP na porta 8080, não ouve ws_tx
        ↓ Solução: criar segundo canal broadcast dedicado (edge_cmd_tx)
        ↓ Mudanças no servidor:
              main.rs → cria (edge_cmd_tx, _) = broadcast::channel(32)
              emergency.rs → envia nos dois canais: ws_tx + edge_cmd_tx
              mod.rs → propaga edge_cmd_tx pela cadeia de handlers
              ingest.rs → split do TcpStream, task dedicada lê edge_cmd_tx
                          e escreve de volta no TCP para o edge
        ↓ Mudanças no edge (Jetson):
              main.rs → split do TcpStream em read_half + write_half
              task separada lê comandos do servidor (read_half)
              send_batch e sync_pending_data usam OwnedWriteHalf
              send_emergency_can() envia frame 0x67 no barramento CAN
        ↓ Bug encontrado: lock do write_half não era solto antes do 'send_loop
                          sync_pending_data segurava o Mutex indefinidamente
                          send_loop tentava adquirir o mesmo lock → deadlock
        ↓ Solução: envolver sync_pending_data em bloco {} para soltar o lock
        ↓ Resultado: EMERGENCY STOP chegando na Jetson e indo ao barramento ✅

2. Implementação do Emergency Resume (religar o carro)
        ↓ Toggle no frontend: botão KILL → RESUME após acionar
        ↓ Nova rota: POST /telemetry/emergency-resume
        ↓ Nova função: handle_emergency_resume em emergency.rs
        ↓ Payload diferente: kill=[0x00;8], resume=[0x01,0x00,...]
        ↓ Edge distingue pelo byte[0] do payload recebido
        ↓ Mudanças no frontend:
              EmergencyButton.jsx → estado isKilled, toggle visual KILL/RESUME
              EmergencyButton.css → classe emergency-btn--killed (verde)
              TopBar.jsx → prop onEmergencyResume
              App.jsx → handler handleEmergencyResume
              telemetryCollection.js → função sendEmergencyResume
        ↓ Resultado: ciclo completo kill/resume funcionando end-to-end ✅

3. Correção do frame CAN de emergência (extended frame + payload correto)
        ↓ Problema: frame chegava no candump com FF FF FF FF FF FF FF FF
        ↓ Causa 1: emergency.rs ainda usava [0xFF; 8] como payload do kill
                   (deveria ser [0x00; 8])
        ↓ Causa 2: log da Jetson estava hardcoded, não refletia payload real
        ↓ Causa 3: frame enviado como StandardId (11 bits)
                   protocolo do carro exige ExtendedId (29 bits)
        ↓ Solução: emergency.rs → frame[12..20] = [0x00; 8] para kill
        ↓ Solução: edge → ExtendedId::new(0x67) em vez de StandardId
        ↓ Solução: edge → log dinâmico baseado nos bytes reais do payload
        ↓ Resultado: frame 0x67 com payload correto no barramento ✅

4. Emergency enviando nos dois barramentos CAN
        ↓ Problema: carro não reagia ao kill mesmo frame aparecendo no candump
        ↓ Causa: send_emergency_can abria hardcoded "can0"
                 VCU ouvia o comando no "can1"
        ↓ Solução: iterar sobre ["can0", "can1"], enviar nos dois sempre
        ↓ Resultado: carro mata motor ao apertar botão ✅

5. CAN_MAP dinâmico via endpoint HTTP
        ↓ Problema: worker.js tinha CAN_MAP estático derivado de CSVs antigos
                    342 IDs nos DBCs, apenas ~15 mapeados no worker
                    frames chegavam ao dashboard marcados como sem_mapa
        ↓ Decisão: endpoint GET /api/can-map serve o DecoderMap do servidor
                   worker faz fetch na inicialização → zero manutenção manual
        ↓ Mudanças no servidor:
              src/api/can_map.rs criado → serializa DecoderMap para JSON
              mod.rs → rota GET /api/can-map, decoder_map propagado pela cadeia
              main.rs → clona decoder_map para o spawn do HTTP server
        ↓ Mudanças no frontend:
              worker.js → CAN_MAP vira objeto vazio, loadCanMap() faz fetch
              store.js → connect() recebe apiBase, dispara loadCanMap antes do WS
              App.jsx → passa buildApiBase() no connect()
        ↓ Bug de build: Vite 8/rolldown não aceita reassignment de const
                        solução: deletar chaves do objeto existente (in-place)
        ↓ Resultado: 342 IDs carregados do servidor, zero rebuild ao mudar DBC ✅

6. Correção de rede e relógio da Jetson para git pull
        ↓ Problema: Jetson sem internet, git pull falhava
        ↓ Causa 1: default gateway apontava para 192.168.1.100 (rede errada)
                   Jetson está na rede 143.106.207.0/24
        ↓ Solução: ip route del default via 192.168.1.100 (duas rotas)
                   ip route add default via 143.106.207.21
        ↓ Causa 2: certificado SSL inválido por relógio defasado da Jetson
        ↓ Solução: sudo date -s "$(curl -sI google.com | grep '^[Dd]ate:' | sed 's/date: //i')"
        ↓ Causa 3: ca-certificates não instalados
        ↓ Solução: sudo apt-get install -y ca-certificates && sudo update-ca-certificates
        ↓ Resultado: git pull funcionando, edge recompilado com novas features ✅

7. SQLite com WAL mode e writer dedicado no edge
        ↓ Problema: SQLite original inseria frame por frame em transação individual
                    sob perda de conexão longa (2h+) o I/O seria gargalo
        ↓ Decisão: manter SQLite (TimescaleDB indisponível na Jetson, sem internet em campo)
        ↓ Solução: WAL mode (journal_mode=WAL) + cache 64MB + synchronous=NORMAL
                   writer dedicado com canal mpsc (100k frames buffer)
                   flush a cada 500 frames OU a cada 2 segundos
                   loop de envio usa try_send (não bloqueia em falha)
        ↓ Canal mpsc persiste entre reconexões TCP
        ↓ Resultado: backup SQLite aguenta 2h+ de CAN sem conexão ✅

8. Primeiro teste com o carro real
        ↓ Carro ligado com Jetson conectada ao servidor via rede
        ↓ Validação de mensagens VCU: sinais APS_PERC, VCU_STATE, SAFETY_OK ✅
        ↓ Validação de mensagens CMD: torque e RPM dos inversores ✅
        ↓ Kill do carro via dashboard: motor desligou ao clicar KILL ✅
        ↓ Resume via dashboard: carro religou ao clicar RESUME ✅
        ↓ Dashboard mostrando sinais em tempo real durante o teste ✅
```

---

## PARTE 2 — DECISÕES TÉCNICAS IMPORTANTES

### Por que o emergency stop precisou de um segundo canal broadcast

O servidor Rust usa o padrão de canais assíncronos (`tokio::sync::broadcast`) para distribuir dados em tempo real. O sistema tinha um único canal `ws_tx` que era consumido pelos clientes WebSocket (browsers). O edge conecta numa porta TCP diferente (8080) e é tratado pelo `ingest.rs`, que nunca recebia mensagens desse canal.

A solução foi criar um canal separado `edge_cmd_tx` exclusivo para comandos destinados ao hardware:

```
Frontend (browser)
  POST /telemetry/emergency-stop
        ↓
  emergency.rs
        ├─ ws_tx.send(frame)       → browsers WebSocket (indicador visual)
        └─ edge_cmd_tx.send(frame) → ingest.rs → TCP → Jetson → CAN
```

O `ingest.rs` agora faz split do `TcpStream` logo que o edge conecta. O `write_half` fica protegido por `Arc<Mutex<>>` e é compartilhado entre a task de comandos (que escreve kills/resumes) e o loop principal (que recebe dados CAN).

### Por que o Mutex travava (o bug do lock indefinido)

O Rust garante que um `MutexGuard` seja liberado quando sai de escopo. O problema era que o `wh` (guard do Mutex) era criado fora do bloco `'send_loop`:

```rust
// ERRADO — wh vive até o fim do bloco externo (loop de reconexão)
let mut wh = write_half.lock().await;
match sync_pending_data(&db_pool, &mut *wh).await { ... }

'send_loop: loop {
    // Aqui tentava pegar write_half.lock() novamente → deadlock
    let mut wh = write_half.lock().await;
    send_batch(&mut *wh, &frames).await
}
```

A correção foi isolar o `sync_pending_data` em um bloco `{}` para forçar o drop do guard antes de entrar no loop:

```rust
// CORRETO — guard é dropado ao sair do bloco {}
{
    let mut wh = write_half.lock().await;
    match sync_pending_data(&db_pool, &mut *wh).await { ... }
} // ← guard dropado aqui

'send_loop: loop {
    let mut wh = write_half.lock().await; // ← consegue adquirir normalmente
    send_batch(&mut *wh, &frames).await
}
```

### Standard Frame vs Extended Frame no protocolo CAN

O protocolo CAN define dois formatos de identificador:

- **Standard Frame (CAN 2.0A)**: identificador de 11 bits, alcance 0x000–0x7FF
- **Extended Frame (CAN 2.0B)**: identificador de 29 bits, alcance 0x00000000–0x1FFFFFFF

O VCU do carro da E-Racing usa o protocolo J1939, que por definição usa Extended Frames. O ID `0x67` em standard e em extended são frames completamente diferentes no barramento elétrico — o flag IDE (Identifier Extension) no campo de arbitragem do CAN indica qual formato está sendo usado. Ao criar o frame no Rust com `StandardId::new(0x67)`, o driver SocketCAN enviava o frame sem o bit IDE setado, e o VCU simplesmente ignorava por não reconhecer o formato.

A correção foi usar `ExtendedId::new(0x67)` que seta o bit IDE corretamente:

```rust
// ERRADO — frame standard de 11 bits
let id = StandardId::new(0x67).expect("ID válido");
let frame = CanFrame::new(Id::Standard(id), &payload)

// CORRETO — frame extended de 29 bits (J1939)
let id = ExtendedId::new(0x67).expect("ID válido");
let frame = CanFrame::new(Id::Extended(id), &payload)
```

### Por que enviamos o kill nos dois barramentos CAN

A Jetson AGX Xavier tem duas interfaces CAN nativas (`can0` e `can1`). O carro da E-Racing tem múltiplos subsistemas conectados em barramentos separados — tipicamente o barramento de powertrain (inversores, BMS) e o barramento de chassis/VCU podem estar em interfaces diferentes. Sem documentação precisa de qual barramento o VCU ouve o comando de shutdown, a solução robusta é enviar para os dois:

```rust
for iface in &["can0", "can1"] {
    // abre socket, monta frame, envia
}
```

Isso garante que independente da topologia de barramento, o comando chega.

### Por que o CAN_MAP dinâmico é superior ao estático

O mapa estático no `worker.js` era mantido à mão com base nos CSVs legados. Toda vez que um DBC mudava, era preciso: (1) identificar o que mudou, (2) converter manualmente para o formato JS, (3) editar o arquivo, (4) fazer rebuild do frontend, (5) copiar para o servidor. Com 342 IDs em 5 arquivos DBC, isso era inviável de manter manualmente.

O endpoint `/api/can-map` serializa o `DecoderMap` que o servidor já carrega dos DBCs no boot. O worker faz fetch uma vez ao conectar e usa esse mapa para toda a sessão. O fluxo de manutenção se torna:

```
Adicionar sinal no DBC → reiniciar servidor → próximo login já tem o sinal
```

Nenhuma alteração no frontend. O mapa do browser e o mapa do backend são sempre o mesmo objeto, gerado pela mesma fonte.

### WAL mode no SQLite — por que faz diferença

SQLite no modo padrão usa um journal de rollback: cada escrita trava o arquivo inteiro para leitura e escrita. Em alta frequência (500–1000 frames/s) isso cria fila de espera de transações.

O WAL (Write-Ahead Log) inverte o mecanismo: em vez de bloquear o arquivo para escrever, escreve em um arquivo de log separado (`.wal`) e periodicamente faz checkpoint para o banco principal. Isso permite:

- Múltiplas leituras simultâneas mesmo durante escrita
- Escritas muito mais rápidas pois são sequenciais no arquivo WAL
- Sem contenção entre o writer dedicado e `sync_pending_data`

Combinado com `PRAGMA synchronous=NORMAL` (não espera flush de disco a cada commit, só a cada checkpoint) e cache de 64MB em RAM, o SQLite da Jetson consegue absorver 2h+ de telemetria contínua sem gargalo.

---

## PARTE 3 — TRABALHO PARALELO: OTIMIZAÇÃO DO BACKEND (Relatório Técnico)

*Esta seção integra o relatório produzido em paralelo durante o período de preparação para o teste.*

### 3.1 Correção de Infraestrutura e Rede (DNS no Servidor)

O servidor não conseguia resolver nomes de domínio (como `index.crates.io`), impedindo o `cargo build` de baixar dependências.

**Causas identificadas:**
- Erro de digitação no Netplan: `adresses` em vez de `addresses`
- Arquivo `/etc/resolv.conf` estático apontando para DNS inacessível (`10.56.239.25`)

**Solução:**
- Corrigido `/etc/netplan/00-installer-config.yaml`
- Atualizado `/etc/resolv.conf` para DNS do Google (`8.8.8.8`) e Cloudflare (`1.1.1.1`)

### 3.2 Otimização do SQLite no Servidor (Alta Frequência)

O servidor apresentava erros de `PoolTimedOut` e `database is locked` por disputas de escrita no SQLite sob carga de 1000+ frames/s.

**Remoção do SQLite do caminho quente:** O `ingest.rs` não insere mais diretamente no SQLite. O banco só é usado para persistência de longo prazo (migração de dados após 7 dias) e autenticação de usuários. O caminho de tempo real é exclusivo do TimescaleDB.

**Bulk Insert com QueryBuilder:** A migração de dados antigos foi otimizada de 5000 INSERTs individuais para um único comando SQL usando `sqlx::QueryBuilder`:

```rust
// ANTES (lento — 5000 roundtrips ao banco):
for row in &rows {
    sqlx::query("INSERT INTO historico ...").bind(...).execute(&mut *tx).await?;
}

// AGORA (bulk — 1 roundtrip com 5000 valores):
let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
    "INSERT OR IGNORE INTO historico (timestamp, device_id, signal_name, value, unit, can_id) "
);
qb.push_values(&rows, |mut b, row| {
    b.push_bind(row.get::<f64, _>("ts"))
     .push_bind(row.get::<String, _>("device_id"))
     // ... outros campos
});
qb.build().execute(sqlite_pool).await?;
```

**Migração em background:** O servidor sobe instantaneamente e dispara a migração em `tokio::spawn` separado, sem travar o boot:

```rust
tokio::spawn(async move {
    info!("🔍 Verificando dados antigos para migração (background)...");
    match db::migrate_old_data(&pg_m, &sq_m).await { ... }
});
```

### 3.3 Suporte a Dual SocketCAN Nativo (Remoção do Kvaser)

O edge estava configurado para um canal SocketCAN e um canal Kvaser via SDK proprietário. A Jetson usa as duas portas nativas via SocketCAN, tornando o driver Kvaser desnecessário.

**Antes (misto SocketCAN/Kvaser):**
```rust
ch1: Option<u32>,  // número do canal Kvaser
```

**Agora (dual SocketCAN nativo):**
```rust
ch1: Option<String>,  // nome da interface: "can1"
// usa run_socketcan_reader para ambos os canais
```

### 3.4 Ingestão em Lote no TimescaleDB (Batch Insert)

O servidor disparava um `tokio::spawn` por sinal decodificado. Com 1000 frames/s e ~10 sinais/frame, isso gerava 10.000 tasks por segundo esgotando o pool de conexões do PostgreSQL.

**Solução — canais mpsc com writers dedicados:**

```rust
// ingest.rs: apenas empurra no canal (não bloqueia)
let _ = timescale_tx.try_send(processed.clone());

// main.rs: task dedicada acumula e insere em lote
tokio::spawn(async move {
    let mut pending = Vec::with_capacity(500);
    loop {
        tokio::select! {
            msg = timescale_rx.recv() => {
                pending.extend(msg?);
                if pending.len() >= 500 {
                    db::save_timescale(&pg, &pending).await;
                    pending.clear();
                }
            }
            _ = interval.tick() => { /* flush periódico */ }
        }
    }
});
```

### 3.5 Diagnóstico de Latência Cumulativa (Clock Drift) e Correção com Chrony

O dashboard relatava latência crescente dos pacotes TCP (de ~14.5ms para 60ms+ em 13 minutos). A causa era **clock drift** — o cristal da Jetson divergia do servidor ao longo do tempo, e esse desvio era erroneamente somado ao timestamp dos frames, parecendo aumento de latência de rede.

**Solução — Chrony como gestor de tempo do SO:**
- Servidor configurado como Mestre de Tempo local (`allow 143.106.207.0/24`, `local stratum 10`)
- Jetson configurada para seguir o servidor (`server 143.106.207.21 iburst trust`)
- NTP interno da aplicação desativado (`--ntp-port 0` no serviço), delegando ao Chrony

### 3.6 Resiliência de Rede Permanente na Jetson

Um script legado do NetworkManager (`99-eracing-route.sh`) sobrescrevia as rotas de rede a cada boot, voltando para gateway antigo (`192.168.1.100`). O `/etc/resolv.conf` também era sobrescrito pelo `systemd-resolved`.

**Solução em três camadas:**

```bash
# Script de rota reescrito para infraestrutura atual:
if [ "$IFACE" = "eth0" ] && [ "$ACTION" = "up" ]; then
    ip route del default 2>/dev/null
    ip route add default via 143.106.207.21 dev eth0 metric 50
    echo -e "nameserver 143.106.207.21\nnameserver 8.8.8.8" > /etc/resolv.conf
    (sleep 2; /usr/bin/chronyc -a makestep) &
fi
```

O `systemd-resolved` foi desativado e o `/etc/resolv.conf` bloqueado contra modificação com `chattr +i`.

### 3.7 Autocura do Barramento CAN (Bus-Off Recovery)

A controladora CAN pode entrar em estado Bus-Off após erros físicos no barramento (ruído, conector solto), parando silenciosamente. Solução em duas camadas:

**Nível de kernel:** parâmetro `restart-ms 100` na subida do link CAN — o driver Linux reinicia a controladora automaticamente após 100ms de erro crítico:
```bash
ip link set can0 type can bitrate 500000 restart-ms 100 && ip link set up can0
```

**Nível de aplicação:** `run_socketcan_reader` encapsula a leitura em loop de reconexão. Se `read_frame()` retorna erro crítico, fecha o socket, aguarda 2s e reabre sem interromper o loop TCP principal.

---

## PARTE 4 — ARQUITETURA ATUAL DO SISTEMA

```
Jetson AGX Xavier (143.106.207.93)
  can-interfaces.service → sobe can0 (500kbps, restart-ms 100)
                           sobe can1 (500kbps, restart-ms 100)
  telemetry-edge.service → lê can0 + can1 via SocketCAN
                         → envia TCP :8080 (4B len + 4B can_id + 8B ts + 8B data)
                         → recebe comandos pelo mesmo TCP (kill/resume)
                         → backup SQLite WAL se conexão cair
                              ↓ TCP :8080 (frames binários)
                              ↑ TCP :8080 (comandos: emergency stop/resume)

Servidor Ubuntu (143.106.207.21)
  telemetry.service (Rust v2.2)
    ingest.rs → recebe frames TCP
              → split: read_half (frames do carro) + write_half (comandos ao carro)
              → task de comando: ouve edge_cmd_tx, escreve kills no TCP
              → decodifica via DecoderMap (carregado dos DBCs)
              → distribui via mpsc:
                  timescale_tx → writer TimescaleDB (500 sinais ou 1s)
                  sqlite_tx    → writer SQLite histórico (500 sinais ou 2s)
              → broadcast ws_tx (frame raw 20 bytes para browsers)
    emergency.rs → POST /telemetry/emergency-stop → ws_tx + edge_cmd_tx
                 → POST /telemetry/emergency-resume → ws_tx + edge_cmd_tx
    can_map.rs   → GET /api/can-map → serializa DecoderMap (342 IDs) como JSON
    api/logs.rs  → GET /telemetry/logs
                 → GET /telemetry/logs/:id/download

Browser (Dashboard)
  worker.js (Web Worker, thread separada)
    → fetch GET /api/can-map na inicialização (342 IDs do servidor)
    → WebSocket ws://servidor:8081/ws?token=JWT
    → handleFrame(): DataView → CAN_MAP lookup → decodeSignal → CircularBuffer
    → postMessage para SolidJS store (granular, por sinal)
  EmergencyButton → KILL (POST /emergency-stop) / RESUME (POST /emergency-resume)
                    toggle visual vermelho/verde, modal de confirmação
  StatusBar       → cards de valor instantâneo
  MotecChart      → gráficos uPlot com LTTB
  DownloadsPage   → lista sessões, download .ld
```

---

## PARTE 5 — STATUS ATUAL DO PROJETO V2.2

### O que está FEITO ✅

| Componente | Status | Observação |
|---|---|---|
| Emergency Stop end-to-end | ✅ | Frontend → Servidor → Jetson → CAN |
| Emergency Resume end-to-end | ✅ | Toggle kill/resume com feedback visual |
| Frame CAN correto (extended, payload zero) | ✅ | ExtendedId(0x67), [0x00;8] |
| Kill em ambos os barramentos | ✅ | can0 + can1 sempre |
| CAN_MAP dinâmico via /api/can-map | ✅ | 342 IDs, zero manutenção manual |
| SQLite WAL + writer dedicado no edge | ✅ | 2h+ sem conexão sem perda |
| Dual SocketCAN nativo (sem Kvaser) | ✅ | can0 + can1 via socketcan crate |
| Autocura Bus-Off (restart-ms 100) | ✅ | Kernel + aplicação |
| Clock sync via Chrony | ✅ | Latência estável, sem drift |
| Rede permanente na Jetson | ✅ | Script NetworkManager + resolv bloqueado |
| Bulk insert TimescaleDB | ✅ | mpsc channel + batch 500 sinais |
| Bulk insert SQLite migração | ✅ | QueryBuilder, 1 roundtrip por lote |
| VCU validada com carro real | ✅ | APS_PERC, VCU_STATE, SAFETY_OK |
| CMD (inversores) validada | ✅ | TORQUE e RPM confirmados |
| Kill/Resume validado em pista | ✅ | Motor desligou e religou via dashboard |

### O que está PENDENTE ❌

| Componente | Prioridade | Descrição |
|---|---|---|
| Limpeza de código | 🔴 Alta | Remover sincronização CSV legada, leitura de CSV no edge, código Kvaser, comentários obsoletos |
| Comentários no código | 🔴 Alta | Documentar funções críticas: ingest, emergency, can_map, writer dedicado |
| Conversor .ld | 🔴 Alta | Continuar desenvolvimento — validação do test_v3.ld no MoTeC i2 Pro pendente |
| Qualidade da câmera | 🟡 Média | Transmissão de vídeo com qualidade insatisfatória — investigar pipeline GStreamer/MediaMTX |
| Dashboard cyber/rede/performance | 🟡 Média | Nova aba para monitoramento de saúde do sistema em tempo real |
| Favicon 404 | 🟢 Baixa | /favicon.ico não servido |
| team-logo.png 404 | 🟢 Baixa | Asset não copiado para static/dist/assets/ |

---

## PARTE 6 — PROBLEMAS RESOLVIDOS E LIÇÕES APRENDIDAS

### TcpStream não pode ser lido e escrito em tasks diferentes sem split

O `TcpStream` do Tokio implementa `AsyncRead + AsyncWrite`, mas não pode ser usado em múltiplas tasks simultaneamente pois não implementa `Clone`. A solução é o método `into_split()` que divide em `OwnedReadHalf` e `OwnedWriteHalf` — dois handles independentes que podem ser movidos para tasks diferentes. O `OwnedWriteHalf` é envolvido em `Arc<Mutex<>>` para ser compartilhado entre a task de comandos e o loop de envio:

```rust
let (mut read_half, write_half) = stream.into_split();
let write_half = Arc::new(tokio::sync::Mutex::new(write_half));

// task A: lê comandos do servidor
tokio::spawn(async move {
    read_half.read_exact(&mut buf).await
});

// task B: envia frames CAN
let mut wh = write_half.lock().await;
send_batch(&mut *wh, &frames).await
```

### O Vite 8 com rolldown não aceita reassignment de const em Web Workers

O Vite 8 usa o rolldown como bundler interno, que aplica análise estática mais rigorosa que versões anteriores. Reatribuir uma variável `const` dentro de um Web Worker causa erro de build mesmo que o código seja semanticamente válido em runtime:

```javascript
// FALHA no build Vite 8 (rolldown):
const CAN_MAP = {};
CAN_MAP = novoMapa; // ILLEGAL_REASSIGNMENT

// CORRETO — mutação in-place do mesmo objeto:
const CAN_MAP = {};
for (const key of Object.keys(CAN_MAP)) delete CAN_MAP[key];
for (const [key, val] of Object.entries(novoMapa)) CAN_MAP[Number(key)] = val;
```

### Protocolo de debug para payload CAN errado

Quando o candump mostra payload diferente do esperado, o processo de diagnóstico é:

1. Verificar o log do edge — o que ele diz que está enviando
2. Verificar se o log é hardcoded ou baseado nos bytes reais
3. Verificar o binário do servidor — pode estar desatualizado (recompilar)
4. Usar `candump can0 & candump can1` para ver o que realmente chegou no barramento

Neste caso o log da Jetson dizia `[0x00]` mas o candump mostrava `[0xFF]` — o log era hardcoded e o servidor estava rodando binário antigo antes da correção do payload.

---

## PARTE 7 — TASKS PENDENTES DETALHADAS

### 1. Limpeza de Código

**telemetry-edge:**
- Remover toda lógica de sincronização CSV (`load_priority_map`, priority map) — agora os IDs vêm do DBC via servidor
- Remover código Kvaser (`kvaser_fii.rs`, feature flag `kvaser`, build.rs condicional)
- Remover campo `priority` do `TelemetryFrame` — não é mais usado na lógica de envio
- Remover `unsafe` block do contador `RECV_COUNT` no leitor SocketCAN

**telemetry-server:**
- Remover `main_antigo.rs` definitivamente (arquivo histórico, nunca mais vai ser usado)
- Remover imports não usados que geram warnings: `save_timescale` no ingest, `PgPoolOptions` no db
- Corrigir `mut socket: TcpStream` no ingest (não precisa de mut após split)

### 2. Comentários no Código

Priorizar funções com maior complexidade ou que resolveram bugs difíceis:
- `ingest.rs::handle_client` — documentar o split e a task de comandos
- `emergency.rs` — documentar por que dois canais (ws_tx vs edge_cmd_tx)
- `main.rs` (edge) — documentar o ciclo de vida do write_half e o deadlock que foi corrigido
- `can_map.rs` — documentar o formato JSON e a conversão de tipos

### 3. Conversor .ld (MoTeC)

Continuar a partir do `test_v3.ld` gerado no Dia 10. Próximos passos:
- Validar test_v3.ld no i2 Pro — abrir e verificar se os canais aparecem
- Se valores errados: ajustar fator de escala (`dec_pl`) e min/max
- Se rejeitado: comparar header byte a byte com arquivo real via `xxd`
- Integrar gerador Python ao endpoint `/telemetry/logs/:id/download`

### 4. Qualidade da Câmera

A câmera já transmite via GStreamer → RTSP → MediaMTX → WebRTC, mas a qualidade está insatisfatória. Investigar:
- Bitrate configurado no pipeline `x264enc` — aumentar `bitrate` e `tune=zerolatency`
- Resolução de captura do ZED via V4L2 — confirmar `2560x720` sendo usado
- `writeQueueSize` no MediaMTX — valor atual 512, testar redução para 256
- Firefox ESR não suporta H264 WebRTC — confirmar uso do Chromium no dashboard

### 5. Dashboard Cyber/Rede/Performance

Nova aba para monitoramento de saúde do sistema em tempo real. Métricas desejadas:
- Latência TCP edge → servidor (já calculada no ingest, expor via WebSocket)
- Taxa de frames por segundo por barramento CAN
- Frames sem mapa (unmapped) por segundo
- Status da conexão da Jetson
- Uso de memória do buffer SQLite de backup
- Uptime dos serviços (telemetry-edge, telemetry-server)

---

## PARTE 8 — CONCEITOS USADOS HOJE

| Conceito | Aplicação |
|---|---|
| **broadcast::channel (Tokio)** | Distribuir comando de emergência para múltiplos receivers (browsers + edge) |
| **TcpStream::into_split()** | Separar leitura e escrita em handles independentes para tasks diferentes |
| **Arc<Mutex<OwnedWriteHalf>>** | Compartilhar o lado de escrita do TCP entre task de comandos e loop principal |
| **Deadlock por MutexGuard vivo** | Guard fora de bloco segura o lock durante o loop inteiro — isolar em {} |
| **Extended Frame CAN (J1939)** | IDs de 29 bits com bit IDE setado — protocolo obrigatório para VCU do carro |
| **candump** | Ferramenta de diagnóstico para verificar frames reais no barramento CAN |
| **WAL mode SQLite** | Write-Ahead Log — escritas sequenciais sem bloquear leituras concorrentes |
| **mpsc channel para backup** | Writer dedicado absorve bursts de 100k frames sem bloquear o loop TCP |
| **QueryBuilder sqlx** | Bulk INSERT de 5000 linhas em 1 roundtrip ao banco |
| **tokio::spawn background** | Migração de dados em background sem travar boot do servidor |
| **Chrony como NTP** | Sincronização contínua de relógio — elimina clock drift acumulativo |
| **restart-ms 100 (SocketCAN)** | Kernel reinicia controladora CAN automaticamente após Bus-Off |
| **chattr +i** | Tornar arquivo imutável no sistema de arquivos — impede sobrescrita do resolv.conf |
| **Rolldown (Vite 8)** | Bundler mais rigoroso que não aceita reassignment de const em Workers |
| **In-place mutation** | Atualizar objeto const deletando chaves antigas e inserindo novas |
| **DecoderMap serialization** | Converter HashMap<u32, Vec<SignalConfig>> para JSON consumível pelo frontend |

---

*Documento gerado em 09/06/2026 — E-Racing Ultra Blaster Telemetria V2.2*
*Primeiro teste com carro real — sistema validado em pista*
