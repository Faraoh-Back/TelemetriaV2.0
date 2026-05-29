# Processamento backend: timestamps da coleta

Este documento descreve a primeira feature backend do fluxo de coleta:
persistir o timestamp inicial quando o usuario inicia a coleta e o timestamp
final quando o usuario encerra a coleta.

## Fonte de verdade

O timestamp oficial da coleta e relativo ao proprio ciclo de coleta, nao ao
relogio do servidor:

- `collection_start_sec`: sempre `0.0`;
- `collection_stop_sec`: duracao em segundos entre iniciar e encerrar coleta;
- `log_start_sec`: sempre `0.0` quando os bounds reais chegam;
- `log_stop_sec`: duracao real do trecho capturado pelo worker.

O backend ainda salva horarios absolutos apenas como auditoria tecnica:

- `started_at_unix` e `started_at_iso`: quando o backend recebeu o start;
- `ended_at_unix` e `ended_at_iso`: quando o backend recebeu o stop;
- `start_requested_at`: horario informado pelo navegador ao pedir start;
- `stop_requested_at`: horario informado pelo navegador ao pedir stop.

Esses campos nao sao o tempo oficial da coleta. Eles servem para depuracao,
auditoria e comparacao de relogios.

## Tabela SQLite

A feature cria a tabela `telemetry_log_sessions` em `data/historico.db`:

```sql
CREATE TABLE IF NOT EXISTS telemetry_log_sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at_unix    REAL    NOT NULL,
    started_at_iso     TEXT    NOT NULL,
    start_requested_at TEXT,
    ended_at_unix      REAL,
    ended_at_iso       TEXT,
    stop_requested_at  TEXT,
    log_start_unix     REAL,
    log_stop_unix      REAL,
    collection_start_sec REAL   NOT NULL DEFAULT 0,
    collection_stop_sec  REAL,
    log_start_sec        REAL,
    log_stop_sec         REAL,
    state              TEXT    NOT NULL DEFAULT 'active',
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Por enquanto existe apenas uma sessao ativa por vez. Uma sessao ativa e uma
linha com `state = 'active'` e `ended_at_unix IS NULL`.

## Endpoints implementados

### Iniciar coleta

```http
POST /telemetry/collection/start
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "requested_at": "2026-05-29T12:00:00.000Z"
}
```

Resposta:

```json
{
  "ok": true,
  "state": "live",
  "id": 1,
  "collection_start_sec": 0.0,
  "started_at": 0.0,
  "received_at": "2026-05-29T15:00:00.120000+00:00"
}
```

Se ja houver coleta ativa, retorna `409 Conflict`.

### Encerrar coleta

```http
POST /telemetry/collection/stop
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "requested_at": "2026-05-29T12:10:00.000Z",
  "log_start_unix": null,
  "log_stop_unix": null
}
```

Resposta:

```json
{
  "ok": true,
  "state": "stopped",
  "id": 1,
  "collection_start_sec": 0.0,
  "collection_stop_sec": 573.32,
  "started_at": 0.0,
  "ended_at": 573.32,
  "duration_seconds": 573.32,
  "received_at": "2026-05-29T15:09:33.440000+00:00"
}
```

Se nao houver coleta ativa, retorna `409 Conflict`.

### Persistir bounds reais do log

```http
POST /telemetry/log-session-bounds
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "log_start_unix": 1780000000.12,
  "log_stop_unix": 1780000573.44
}
```

O frontend chama este endpoint depois que o worker local calcula os limites
reais do historico capturado. O backend guarda os bounds absolutos recebidos
como referencia tecnica, mas tambem normaliza o trecho para `0.0` ate a duracao
real capturada.

Resposta:

```json
{
  "ok": true,
  "id": 1,
  "status": "processing",
  "log_start_sec": 0.0,
  "log_stop_sec": 573.32,
  "duration_seconds": 573.32
}
```

## Validacao atual

- `401`: token ausente, invalido ou expirado;
- `400`: JSON invalido ou bounds invertidos;
- `409`: estado invalido da coleta;
- `500`: erro inesperado de banco/servidor.

Nesta etapa, os endpoints exigem apenas usuario autenticado. A regra
`admin/member` sera implementada na proxima feature, quando o JWT e o login
passarem a carregar role/permissoes.

## Decisao aplicada

O tempo oficial da coleta nao e um horario absoluto. Ao clicar em iniciar
coleta, o tempo passa a ser `0.0`; ao encerrar, o timestamp final e a duracao
da coleta em segundos.
