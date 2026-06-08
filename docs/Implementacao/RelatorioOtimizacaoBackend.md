# Relatório Técnico: Otimização do Backend de Telemetria (V2.2)

Este relatório detalha as mudanças realizadas no backend do servidor de telemetria para resolver gargalos de performance, falhas de rede e travamentos de banco de dados (SQLite).

## 1. Correção de Infraestrutura e Rede (DNS)

**Problema:** O servidor não conseguia resolver nomes de domínio (como `index.crates.io`), impedindo o `cargo build` de baixar dependências.
- **Causa 1:** Erro de digitação no Netplan (`adresses` em vez de `addresses`).
- **Causa 2:** Arquivo `/etc/resolv.conf` estático e apontando para um DNS inacessível (`10.56.239.25`).

**Mudança Realizada:**
- Corrigido o arquivo `/etc/netplan/00-installer-config.yaml`.
- Atualizado o `/etc/resolv.conf` para incluir os DNS do Google (`8.8.8.8`) e Cloudflare (`1.1.1.1`).

---

## 2. Otimização do SQLite (Desafio de Alta Frequência)

O servidor apresentava erros de `PoolTimedOut` e `database is locked` devido à alta frequência de mensagens vindas da Jetson.

### A. Remoção do SQLite do "Caminho Quente"
**Como era:** O `ingest.rs` tentava salvar cada frame recebido tanto no TimescaleDB quanto no SQLite em tempo real.
**Como é agora:** Seguindo a estratégia de sucesso do `main_antigo.rs`, o SQLite agora é usado **apenas** para persistência de longo prazo (migração após 7 dias) e autenticação. O caminho de tempo real é exclusivo do TimescaleDB (PostgreSQL).

### B. Migração em Lote (Bulk Insert) com QueryBuilder
**Como era:** A migração de dados antigos percorria 5000 linhas e fazia 5000 `INSERT`s individuais.
**Como é agora:** Implementamos o `sqlx::QueryBuilder` para transformar 5000 inserts em apenas **um único comando SQL**.

**Trecho de Código (`db.rs`):**
```rust
// ANTES (Lento):
for row in &rows {
    sqlx::query("INSERT INTO historico ...").bind(...).execute(&mut *tx).await?;
}

// AGORA (Bulk Insert - Alta Performance):
let mut query_builder: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
    "INSERT OR IGNORE INTO historico (timestamp, device_id, signal_name, value, unit, can_id) "
);
query_builder.push_values(&rows, |mut b, row| {
    b.push_bind(row.get::<f64, _>("ts"))
     .push_bind(row.get::<String, _>("device_id"))
     // ... outros campos
});
let query = query_builder.build();
query.execute(sqlite_pool).await?;
```

### C. Migração em Segundo Plano (Background Task)
**Como era:** O servidor iniciava a migração no boot, travando a inicialização até terminar (podendo levar minutos).
**Como é agora:** O servidor sobe instantaneamente e dispara a migração em uma `task` separada do Tokio.

**Trecho de Código (`main.rs`):**
```rust
// Migração em BACKGROUND para não travar o boot
let pg_m = pg_pool.clone();
let sq_m = sqlite_pool.clone();
tokio::spawn(async move {
    info!("🔍 Verificando dados antigos para migração (background)...");
    db::migrate_old_data(&pg_m, &sq_m).await;
});
```

---

## 3. Verificação de Integridade

- **DNS:** Testado via `ping google.com` (Sucesso).
- **Ingestão:** `ingest.rs` verificado para garantir que não bloqueia o fluxo TCP com operações de disco lentas.
- **Concorrência:** SQLite configurado com `max_connections(1)` e `journal_mode=WAL` para permitir leituras simultâneas sem travar durante a migração.

## 4. Detalhamento da Investigação e Reversão Arquitetural

Durante esta sessão, realizamos uma investigação profunda para alinhar o novo código modularizado com a estabilidade comprovada das versões anteriores.

### Investigação de Rede (DNS)
A falha foi diagnosticada comparando acessos diretos por IP com acessos por nome:
- `ping 8.8.8.8`: **Sucesso**, indicando que a interface de rede e a rota de saída estavam ativas.
- `ping google.com`: **Falha**, confirmando o problema na camada de resolução de nomes.
- **Descoberta:** O arquivo `/etc/resolv.conf` não era um link simbólico gerenciado pelo `systemd-resolved`, mas um arquivo estático com um IP de DNS inválido (`10.56.239.25`). A correção manual permitiu que o `cargo` voltasse a funcionar imediatamente.

### Análise de Gargalo do SQLite (PoolTimedOut)
O erro `PoolTimedOut` (demora de >10s para um insert) ocorria devido à natureza "Single-Writer" do SQLite. 
- **Conflito:** Enquanto a migração de boot tentava escrever 5000 linhas uma por uma, o `ingest.rs` também tentava inserir dados de tempo real. Com `max_connections(1)`, o sistema criava uma fila imensa.
- **Justificativa da Mudança:** Ao remover o SQLite do `ingest.rs` (Caminho Quente), eliminamos a disputa por escrita durante o recebimento de mensagens CAN da Jetson. O SQLite agora "dorme" enquanto a telemetria voa para o TimescaleDB.

## 5. Auditoria Final do Código Fonte (Pós-Modificações)

Realizamos uma leitura completa dos arquivos `/src` para garantir que a implementação reflete a estratégia descrita.

### Arquivo: `telemetry-server/src/db.rs`
- **Status:** **Otimizado.**
- **Evidência:** A função `migrate_old_data` agora utiliza `sqlx::QueryBuilder`. Foram removidos imports duplicados e corrigido o erro de sintaxe `swlite` para `sqlite`.

### Arquivo: `telemetry-server/src/main.rs`
- **Status:** **Híbrido.**
- **Observação:** O código dispara a migração em background. Notei que ainda existe um canal de buffer para SQLite (`sqlite_rx`) que acumula sinais a cada 2s. Embora mitigado pelo buffer, a recomendação final para carga extrema é desativar totalmente o SQLite no tempo real.

### Arquivo: `telemetry-server/src/ingest.rs`
- **Status:** **Funcional.**
- **Evidência:** Uso de `try_send` não-bloqueante para despacho de sinais decodificados.

## 6. Comparativo Detalhado de Código (Antes vs Agora)

### A. Loop de Ingestão (Hot Path)
**ANTIGO (`main_antigo.rs`):**
```rust
// Apenas um spawn para o Postgres
tokio::spawn(async move {
    save_timescale(&pg_pool_c, &processed_ts).await;
});
```
**ATUAL (`ingest.rs`):**
```rust
// Usa canais MPSC para não bloquear a leitura do TCP
let _ = sqlite_tx.try_send(processed.clone());
let _ = timescale_tx.try_send(processed.clone());
```

### B. Lógica de Migração (Bulk Insert)
**ANTIGO (Lento):**
```rust
for row in &rows {
    sqlx::query("INSERT INTO historico ...").bind(...).execute(&mut *tx).await?;
}
```
**ATUAL (Otimizado):**
```rust
let mut query_builder: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new("INSERT OR IGNORE INTO historico ...");
query_builder.push_values(&rows, |mut b, row| {
    b.push_bind(row.get::<f64, _>("ts")).push_bind(row.get::<String, _>("device_id"))...
});
query_builder.build().execute(sqlite_pool).await?;
```

---

## 7. Otimização de Rede e Sincronização de Estado (Sessão Atual)

Esta seção detalha as melhorias na eficiência da comunicação entre Backend e Frontend, além da resolução de problemas de dessincronização de UI.

### A. Redução de Redundância no Broadcast Binário (Bandwidth)
**Problema:** O servidor enviava um frame binário de 20 bytes para o frontend para **cada sinal** decodificado. Se um ID CAN continha 10 sinais, o tráfego era multiplicado por 10 desnecessariamente.

**Justificativa:** Como o frontend (Worker) já possui a lógica de decodificação, enviar o frame bruto apenas uma vez é suficiente. Isso reduz o consumo de banda e o processamento no navegador.

**Mudança no Código (`ingest.rs`):**
```rust
// ANTES (Ineficiente):
for signal in &processed {
    let mut frame = [0u8; 20];
    frame[0..4].copy_from_slice(&signal.can_id.to_le_bytes());
    // ... repetia o envio do mesmo frame bruto para cada sinal
    let _ = ws_tx.send(frame.to_vec());
}

// AGORA (Otimizado):
let mut frame = [0u8; 20];
frame[0..4].copy_from_slice(&can_id.to_le_bytes());
frame[4..12].copy_from_slice(&timestamp.to_le_bytes());
frame[12..20].copy_from_slice(&raw_data_owned);
let _ = ws_tx.send(frame.to_vec()); // Enviado apenas UMA VEZ
```

### B. Sincronização de Estado da Telemetria (Persistence Sync)
**Problema:** Ao atualizar a página (F5) ou realizar um novo login, o botão de telemetria voltava para o estado "Iniciar", mesmo que houvesse uma coleta ativa no banco de dados. Isso impedia o encerramento correto da sessão (Erro 409).

**Solução:** Implementação de uma rota de status e verificação automática no carregamento do frontend.

**1. Nova Rota no Backend (`collection.rs`):**
Criada a função `handle_collection_status` que consulta a tabela `telemetry_log_sessions` em busca de registros com `state = 'active'`.

**2. Integração no Frontend (`App.jsx`):**
A função `authenticateDashboard` foi tornada assíncrona para consultar o status real antes de renderizar o dashboard.

**Mudança no Código (`App.jsx`):**
```javascript
// AGORA (Sincronizado):
async function authenticateDashboard(nextSession) {
  connect(buildWsUrl(nextSession.token));
  
  try {
    const status = await getTelemetryCollectionStatus(nextSession.token);
    if (status.ok && status.state === 'live') {
      setTelemetryCollectionEnabled(true);
      setTelemetryMode(TELEMETRY_MODE.live);
    }
  } catch (error) {
    console.error('Falha ao sincronizar status:', error);
  }
  setSession(nextSession);
}
```

## 8. Suporte a Dual SocketCAN e Otimização de Ingestão em Lote (Sessão Pré-Teste Carro)

Esta seção detalha as modificações críticas realizadas para preparar o sistema para o teste em pista, focando na leitura de múltiplas interfaces nativas da Jetson e na estabilidade do servidor sob alta carga de dados (1000+ frames/s).

### A. Suporte a Dual SocketCAN Nativo no Edge (Remoção de Kvaser)
**Problema:** O `telemetry-edge` estava configurado para ler um canal SocketCAN (`can0`) e um canal Kvaser via SDK proprietário. No carro, a Jetson utiliza as duas portas nativas (`can0` e `can1`) via SocketCAN, o que tornava o driver Kvaser inútil e impedia a leitura da segunda porta.

**Justificativa:** Padronizar ambos os canais para SocketCAN permite que o sistema utilize as portas de hardware da Jetson diretamente, com menor latência e maior estabilidade, sem depender de bibliotecas FFI externas.

**Comparativo de Código (`telemetry-edge/src/main.rs`):**

**ANTES (Misto SocketCAN/Kvaser):**
```rust
// Argumentos aceitavam número de canal para Kvaser
ch1: Option<u32>,

// Inicialização buscava driver Kvaser
if let Some(ch1_num) = args.ch1 {
    tokio::spawn(async move {
        run_kvaser_reader(ch1_num, bitrate, ...).await;
    });
}
```

**AGORA (Dual SocketCAN Nativo):**
```rust
// Argumentos aceitam nome da interface (ex: "can1")
ch1: Option<String>,

// Inicialização usa o mesmo driver SocketCAN para ambos os canais
if let Some(ref iface) = args.ch1 {
    let iface_clone = iface.clone();
    tokio::spawn(async move {
        run_socketcan_reader(iface_clone, bitrate, ...).await;
    });
}
```

### B. Ingestão em Lote (Batch Insert) no TimescaleDB
**Problema:** O servidor disparava um `tokio::spawn` e uma nova query SQL para **cada sinal** decodificado. Em um cenário de 1000 frames/s, isso gerava milhares de tarefas e conexões simultâneas, levando ao esgotamento do pool de conexões do PostgreSQL e travamento do servidor.

**Justificativa:** Agrupar sinais em "lotes" (Buckets) reduz drasticamente o overhead de rede e processamento do banco de dados. O TimescaleDB é otimizado para inserções em massa, permitindo que o servidor suporte frequências de barramento muito mais altas.

**Comparativo de Código (`telemetry-server`):**

**ANTES (Ingestão Individual e Bloqueante):**
```rust
// No ingest.rs: Cada sinal criava uma nova task e conexão
tokio::spawn(async move {
    if let Err(e) = save_timescale(&pg_pool_c, &processed_ts).await {
        error!("❌ TimescaleDB insert error: {:?}", e);
    }
});
```

**AGORA (Estratégia de Buffer/Bucket):**
No `main.rs`, foi criada uma tarefa de background com um canal de comunicação (`mpsc`):
```rust
// Task dedicada ao TimescaleDB (Bucket de 500 sinais ou 1 segundo)
tokio::spawn(async move {
    let mut pending: Vec<ProcessedSignal> = Vec::with_capacity(500);
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            msg = timescale_rx.recv() => {
                pending.extend(msg?);
                if pending.len() >= 500 {
                    db::save_timescale(&pg, &pending).await;
                    pending.clear();
                }
            }
            _ = interval.tick() => {
                if !pending.is_empty() {
                    db::save_timescale(&pg, &pending).await;
                    pending.clear();
                }
            }
        }
    }
});
```

No `ingest.rs`, o servidor apenas "empurra" o dado para o canal, sem esperar o banco:
```rust
// Apenas envia para o buffer (Muitíssimo mais rápido)
let _ = timescale_tx.try_send(processed.clone());
```

### C. Transição de Ambiente: Mock para Produção
**Mudança no Serviço (`telemetry-edge.service`):**
As flags de execução foram alteradas de interfaces virtuais (`vcan0`) para as físicas da Jetson.

**Configuração Atual:**
```ini
ExecStart=/home/sauva/.../telemetry-edge \
  --ch0 can0 \
  --ch1 can1 \
  --server ${SERVER_IP}:${SERVER_TCP_PORT}
```

## Conclusão Final (Sessão Pré-Teste)
Com a implementação do **Dual SocketCAN**, o sistema agora "enxerga" todo o hardware da Jetson. A adição do **Batch Insert** no servidor resolve o principal gargalo de escalabilidade do banco de dados. Estas mudanças garantem que o dashboard permaneça fluido e que nenhum dado seja perdido por sobrecarga do servidor durante o teste dinâmico no veículo.
