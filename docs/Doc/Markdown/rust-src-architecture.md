# Arquitetura Rust do `telemetry-server/src`

Atualizado em 2026-06-02.

Este documento descreve a organizacao atual dos arquivos Rust do servidor de
telemetria depois da modularizacao. O objetivo e servir como mapa rapido para
manutencao, revisao de features e novas rotas HTTP.

## Visao Geral

O backend Rust roda tres servicos principais:

- TCP CAN em `0.0.0.0:8080`: recebe frames enviados pelo edge/car.
- HTTP + WebSocket em `0.0.0.0:8081`: serve o frontend, login, comandos HTTP e stream WebSocket.
- NTP simples em `0.0.0.0:9999`: ajuda o edge a corrigir timestamp.

O servidor usa dois bancos:

- TimescaleDB/Postgres: caminho quente de telemetria em tempo real, tabela `sensor_data`.
- SQLite: historico persistente, usuarios e sessoes de coleta, arquivo `./data/historico.db`.

Fluxo principal:

```text
Edge/Jetson
  -> TCP :8080
  -> ingest::handle_client
  -> decoder::decode_signal
  -> db::save_timescale
  -> broadcast::Sender<Vec<u8>>
  -> ws::handle_ws_upgrade
  -> Browser/App
```

Fluxo administrativo:

```text
Browser/App
  -> HTTP :8081
  -> api::handle_http_connection
  -> auth/api handlers
  -> SQLite
```

## Arvore de Modulos

```text
src/
  main.rs
  config.rs
  models.rs
  auth.rs
  db.rs
  decoder.rs
  ingest.rs
  ws.rs
  ntp.rs
  track_state.rs
  api/
    mod.rs
    http.rs
    auth_handlers.rs
    collection.rs
    migrate.rs
  main_antigo.rs
```

`main_antigo.rs` e uma copia legada/arquivo historico. A arquitetura ativa parte
de `main.rs` e dos modulos listados acima.

## Responsabilidades Por Arquivo

### `main.rs`

Ponto de entrada do processo.

Responsabilidades:

- carrega `.env`;
- inicializa tracing/logs;
- valida variaveis obrigatorias (`DB_PASSWORD`, `JWT_SECRET`);
- carrega mapeamentos CAN de `dbc_data` e cai para `csv_data` se necessario;
- inicializa TimescaleDB e SQLite;
- roda migracao automatica de dados antigos;
- cria canal `broadcast::Sender<Vec<u8>>` para WebSocket;
- cria `RealtimeTrackState` compartilhado;
- inicia HTTP+WS, NTP e listener TCP CAN.

Dependencias diretas principais:

- `config`: portas, paths e segredos;
- `decoder`: carregamento de DBC/CSV;
- `db`: init e migracao;
- `api`: servidor HTTP+WS;
- `ntp`: servidor de timestamp;
- `ingest`: conexoes TCP de telemetria;
- `track_state`: estado derivado do mapa.

### `config.rs`

Centraliza constantes e acesso a variaveis de ambiente.

Valores principais:

- `TCP_PORT = 8080`;
- `HTTP_WS_PORT = 8081`;
- `NTP_PORT = 9999`;
- `SQLITE_PATH = "sqlite:./data/historico.db"`;
- paths de CSV/DBC;
- limite de conexoes Postgres;
- expiracao do JWT;
- parametros de calibracao para mapa/RPM.

Funcoes:

- `get_pg_url()`: monta URL Postgres usando `DB_PASSWORD`;
- `get_jwt_secret()`: le `JWT_SECRET`.

### `models.rs`

Define estruturas compartilhadas entre modulos.

Modelos atuais:

- `ProcessedSignal`: sinal CAN ja decodificado, usado em ingestao, persistencia e mapa;
- `Claims`: payload JWT;
- `LoginRequest`;
- `CollectionStartRequest`;
- `CollectionStopRequest`;
- `LogSessionBoundsRequest`.

Este arquivo deve conter modelos pequenos e transversais. Payloads muito
especificos de uma area podem ficar no modulo da feature se crescerem demais.

### `auth.rs`

Concentra autenticacao, autorizacao e permissoes.

Responsabilidades:

- papeis: `admin`, `member`;
- permissoes: `telemetry:start`, `telemetry:stop`, `logs:read`, `logs:download`;
- normalizacao de role;
- permissao padrao por role;
- geracao e validacao de JWT HS256;
- extracao de token por header `Authorization: Bearer` ou query string `?token=`;
- helper `claims_has_permission`.

Observacao importante: atualmente `member` recebe apenas `logs:read` no backend
Rust. Se o frontend permitir download para member, o backend precisa alinhar
`permissions_for_role` com `logs:download`.

### `db.rs`

Modulo de inicializacao, persistencia e migracao de dados.

TimescaleDB:

- cria extensao TimescaleDB;
- cria tabela `sensor_data`;
- cria hypertable;
- cria indices por device/signal/time;
- aplica politica de retencao de 7 dias;
- `save_timescale()` insere sinais decodificados no caminho quente.

SQLite:

- cria tabela `historico`;
- cria indices historicos;
- cria tabela `users`;
- normaliza role de usuarios admin antigos;
- habilita WAL;
- cria tabela `telemetry_log_sessions`;
- `save_sqlite()` insere sinais no historico;
- `migrate_old_data()` move dados antigos do TimescaleDB para SQLite em lotes.

Observacao: no fluxo TCP atual, `ingest.rs` chama `save_timescale()`. A migracao
cuida de mover dados antigos para SQLite.

### `decoder.rs`

Parser e decodificador CAN.

Responsabilidades:

- carregar mapas CAN a partir de CSV legado;
- carregar mapas CAN a partir de DBC;
- representar sinais com `SignalConfig`;
- suportar byte order Intel e Motorola;
- extrair bits;
- aplicar signed/unsigned, factor e offset;
- `decode_signal()` transforma bytes CAN em valor fisico.

No boot, `main.rs` tenta carregar DBC primeiro. Se falhar, cai para CSV.

### `ingest.rs`

Recebe dados do carro pelo TCP e coloca a telemetria no sistema.

Protocolo esperado:

- 4 bytes little-endian com tamanho do payload;
- payload com pelo menos 20 bytes;
- bytes `0..4`: CAN ID little-endian;
- bytes `4..12`: timestamp `f64` little-endian;
- bytes `12..20`: 8 bytes de dados CAN.

Fluxo interno:

1. le pacote TCP;
2. valida tamanho;
3. extrai CAN ID, timestamp e raw data;
4. calcula latencia aproximada;
5. busca sinais no `DecoderMap`;
6. decodifica para `ProcessedSignal`;
7. persiste sinais no TimescaleDB em task separada;
8. envia frames binarios CAN para o broadcast WebSocket;
9. atualiza `RealtimeTrackState`;
10. envia mensagens JSON de mapa/pose pelo mesmo canal broadcast.

O WebSocket recebe `Vec<u8>` tanto para frame CAN binario quanto para mensagens
JSON de mapa. O frontend diferencia pelo formato/conteudo recebido.

### `ws.rs`

Implementa WebSocket manualmente, sem framework.

Responsabilidades:

- validar token no header ou query string;
- rejeitar conexoes sem JWT valido;
- extrair `Sec-WebSocket-Key`;
- calcular `Sec-WebSocket-Accept`;
- enviar handshake `101 Switching Protocols`;
- assinar o canal broadcast;
- empacotar mensagens como frames binarios WebSocket;
- lidar com cliente lento via `RecvError::Lagged`.

O arquivo tambem contem implementacoes locais de SHA-1 e Base64 usadas no
handshake WebSocket.

### `track_state.rs`

Estado derivado para mapa de pista em tempo real.

Responsabilidades:

- integrar sinais de aceleracao, yaw rate, velocidade direta e RPM;
- aprender primeira volta durante `TRACK_LAP_PERIOD_SEC`;
- congelar mapa apos a primeira volta;
- normalizar pontos para o frontend;
- emitir mensagens JSON:
  - `track_status`;
  - `track_map`;
  - `track_pose`.

O estado e compartilhado como `Arc<Mutex<RealtimeTrackState>>` e atualizado pelo
loop de ingestao.

### `ntp.rs`

Servidor TCP simples de sincronizacao temporal.

Protocolo:

- cliente envia 8 bytes;
- servidor responde 16 bytes:
  - `t2` em `f64` little-endian;
  - `t3` em `f64` little-endian.

Usado pelo edge para estimar offset e enviar timestamps mais proximos do relogio
do servidor.

## Modulo `api/`

O modulo `api` concentra HTTP e rotas administrativas. Ele nao usa framework web;
o roteamento e feito por comparacao da primeira linha HTTP.

### `api/mod.rs`

Servidor HTTP+WS.

Responsabilidades:

- abrir listener em `HTTP_WS_PORT`;
- aceitar conexoes;
- ler request em buffer;
- selecionar handler pela primeira linha;
- clonar pools/canais para cada conexao.

Rotas atuais:

```text
GET  /
POST /login
GET  /ws
POST /telemetry/collection/start
POST /telemetry/collection/stop
POST /telemetry/log-session-bounds
POST /migrate
GET  /assets/*
GET  /worker.js
GET  /favicon.svg
GET  /icons.svg
```

Rotas de downloads (`GET /telemetry/logs` e
`GET /telemetry/logs/:id/download`) ainda nao aparecem nesse roteador Rust atual.
Quando forem implementadas, devem entrar neste modulo como um novo submodulo,
por exemplo `api/logs.rs`.

### `api/http.rs`

Helpers HTTP compartilhados.

Responsabilidades:

- servir `static/dist/index.html`;
- servir assets estaticos de `./static/dist`;
- enviar JSON com status HTTP;
- parsear corpo JSON;
- validar permissao em requests autenticados;
- converter `DateTime<Utc>` para segundos Unix em `f64`;
- expor aliases internos de permissao start/stop.

### `api/auth_handlers.rs`

Handler de login.

Fluxo:

1. parseia `LoginRequest`;
2. busca usuario no SQLite;
3. verifica senha com bcrypt;
4. normaliza role;
5. gera JWT;
6. retorna token, role e permissoes para o frontend.

### `api/collection.rs`

Handlers administrativos de sessao de coleta.

Rotas:

- `POST /telemetry/collection/start`: exige `telemetry:start`;
- `POST /telemetry/collection/stop`: exige `telemetry:stop`;
- `POST /telemetry/log-session-bounds`: exige `telemetry:stop`.

Tabela usada:

- `telemetry_log_sessions`.

Responsabilidades:

- impedir duas coletas ativas ao mesmo tempo;
- criar sessao ativa;
- encerrar sessao ativa;
- gravar timestamps de inicio/fim;
- calcular duracao da coleta;
- persistir bounds reais do log apos o frontend desligar a coleta local.

Observacao para evolucao recente: o frontend pode enviar `log_name`, mas os
modelos Rust atuais ainda nao declaram esse campo e a tabela
`telemetry_log_sessions` ainda nao tem coluna de nome. Para persistir o nome da
sessao no backend real, sera necessario adicionar esse campo em
`CollectionStopRequest`, `LogSessionBoundsRequest` e na tabela/migracao SQLite.

### `api/migrate.rs`

Handler manual de migracao.

Rota:

- `POST /migrate`: exige permissao `telemetry:start`.

Responsabilidade:

- chama `db::migrate_old_data()`;
- retorna quantidade migrada.

## Fluxos Principais

### Boot

```text
main.rs
  -> dotenv + tracing
  -> config::get_pg_url / get_jwt_secret
  -> decoder::load_can_mappings_from_dbc_dir
     -> fallback decoder::load_can_mappings
  -> db::init_timescale
  -> db::init_sqlite
  -> db::migrate_old_data
  -> spawn api::run_http_ws_server
  -> spawn ntp::run_ntp_server
  -> bind TCP :8080
```

### Ingestao CAN

```text
TCP client
  -> ingest::handle_client
  -> decoder_map.get(can_id)
  -> decoder::decode_signal
  -> db::save_timescale
  -> ws_tx.send(raw CAN frame)
  -> track_state.update(processed)
  -> ws_tx.send(track JSON)
```

### Login e Autorizacao

```text
POST /login
  -> api::auth_handlers::handle_login
  -> SQLite users
  -> bcrypt verify
  -> auth::generate_jwt
  -> frontend guarda token
```

```text
Rota protegida
  -> api::http::api_request_has_permission
  -> auth::extract_bearer_token
  -> auth::validate_jwt_claims
  -> auth::claims_has_permission
```

### WebSocket

```text
GET /ws?token=...
  -> api::mod dispatch
  -> ws::handle_ws_upgrade
  -> valida JWT
  -> handshake manual
  -> subscribe no broadcast
  -> envia frames binarios para browser
```

### Start/Stop de Coleta

```text
POST /telemetry/collection/start
  -> api::collection::handle_collection_start
  -> valida telemetry:start
  -> cria telemetry_log_sessions state=active
```

```text
POST /telemetry/collection/stop
  -> api::collection::handle_collection_stop
  -> valida telemetry:stop
  -> localiza sessao active
  -> grava ended_at, duration e state=stopped
```

```text
POST /telemetry/log-session-bounds
  -> api::collection::handle_log_session_bounds
  -> valida telemetry:stop
  -> atualiza log_start_unix/log_stop_unix da ultima sessao stopped
```

## Banco de Dados

### TimescaleDB

Tabela `sensor_data`:

```text
time TIMESTAMPTZ
device_id TEXT
signal_name TEXT
value DOUBLE PRECISION
unit TEXT
can_id INTEGER
quality TEXT
```

Uso:

- ingestao de alta frequencia;
- retencao configurada em 7 dias;
- dados antigos migrados para SQLite.

### SQLite

Tabela `historico`:

- historico persistente de sinais migrados;
- indices por timestamp, signal e device.

Tabela `users`:

- login web;
- senha com bcrypt;
- role `admin`/`member`.

Tabela `telemetry_log_sessions`:

- controle de sessoes de coleta;
- timestamps reais e relativos;
- estado `active`/`stopped`.

## Convencoes Para Novas Features

### Nova rota HTTP

Padrao recomendado:

1. criar submodulo em `src/api`, por exemplo `logs.rs`;
2. declarar `mod logs;` em `api/mod.rs`;
3. adicionar dispatch em `handle_http_connection`;
4. usar helpers de `api/http.rs` para JSON e permissao;
5. colocar structs de request/response em `models.rs` se forem compartilhadas;
6. manter acesso a banco dentro do handler ou extrair para `db.rs` quando for reutilizavel.

### Downloads de logs

Quando o backend de downloads for implementado, o encaixe natural e:

```text
src/api/logs.rs
  GET /telemetry/logs
  GET /telemetry/logs/:id/download
```

Permissoes esperadas:

- listar: `logs:read`;
- baixar: `logs:download`.

Tambem sera necessario alinhar `auth::permissions_for_role()` com o contrato de
produto: se `member` deve baixar logs, precisa receber `logs:download`.

### Nome da sessao de telemetria

Para persistir `log_name` enviado pelo frontend:

1. adicionar coluna em `telemetry_log_sessions`;
2. adicionar `ALTER TABLE ... ADD COLUMN log_name TEXT` em `db::init_sqlite`;
3. adicionar `log_name: Option<String>` nos modelos de stop/bounds;
4. gravar `log_name` em `api/collection.rs`;
5. expor o nome na futura listagem `GET /telemetry/logs`.

## Pontos de Atencao

- O servidor HTTP e WebSocket sao implementados manualmente. Mudancas em parsing,
  CORS, headers ou roteamento precisam ser cuidadosas.
- `api/http.rs` embute `static/dist/index.html` em tempo de compilacao, mas assets
  sao lidos de `./static/dist` em runtime.
- `main_antigo.rs` nao faz parte do fluxo ativo e nao deve receber novas features.
- O broadcast WebSocket usa `Vec<u8>` generico para frames CAN e mensagens JSON.
- O caminho quente de ingestao faz insert no TimescaleDB em task separada; falhas
  sao logadas mas nao interrompem a conexao TCP.
- O SQLite esta com pool de uma conexao, adequado para serializar operacoes locais
  e reduzir disputa de escrita.
