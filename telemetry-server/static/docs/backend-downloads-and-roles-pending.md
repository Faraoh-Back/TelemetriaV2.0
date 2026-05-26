# Pendencias do backend: downloads e perfis de acesso

Este documento lista o que o backend precisa entregar para a feature de
downloads de logs e controle por perfil funcionar em producao.

## 1. Login com perfil e permissoes

Atualizar `POST /login` para devolver token e dados de usuario.

Resposta esperada:

```json
{
  "ok": true,
  "token": "jwt",
  "user": {
    "username": "joao",
    "role": "admin",
    "permissions": [
      "telemetry:start",
      "telemetry:stop",
      "logs:read",
      "logs:download"
    ]
  }
}
```

Perfis iniciais:

- `admin`: `telemetry:start`, `telemetry:stop`, `logs:read`, `logs:download`
- `member`: `logs:read`, `logs:download`

O backend deve validar as permissoes a partir do token/sessao. O frontend usa
esses campos apenas para adaptar a interface.

## 2. Listagem de logs

Endpoint:

```http
GET /telemetry/logs
Authorization: Bearer <token>
```

Query params suportados:

```text
from=<ISO-8601 ou Unix seconds>
to=<ISO-8601 ou Unix seconds>
format=<raw|csv|json|motec|other>
status=<ready|processing|failed|expired>
q=<texto livre>
limit=50
cursor=<cursor>
```

Permissao exigida:

```text
logs:read
```

Resposta esperada:

```json
{
  "ok": true,
  "items": [
    {
      "id": "log_2026_05_26_001",
      "name": "Treino 1 - stint 3",
      "created_at": "2026-05-26T18:12:00Z",
      "started_at": "2026-05-26T18:01:22Z",
      "ended_at": "2026-05-26T18:10:55Z",
      "duration_seconds": 573,
      "format": "csv",
      "content_type": "text/csv",
      "size_bytes": 1843200,
      "status": "ready",
      "download_url": null,
      "metadata": {
        "vehicle": "EV",
        "driver": "Piloto",
        "source": "telemetry-server"
      }
    }
  ],
  "next_cursor": null
}
```

## 3. Download de log

Endpoint autenticado:

```http
GET /telemetry/logs/:id/download
Authorization: Bearer <token>
```

Permissao exigida:

```text
logs:download
```

Resposta:

- corpo do arquivo no formato real do backend;
- `Content-Type` correto;
- `Content-Disposition: attachment; filename="nome.ext"`.

Alternativa aceita:

- enviar `download_url` assinado na listagem;
- nesse caso a URL deve ser temporaria e ja autorizada pelo backend/storage.

## 4. Controle administrativo de coleta

Estado atual no frontend:

- `admin` ve e aciona os controles de coleta.
- `member` nao ve comandos acionaveis de iniciar/encerrar coleta.
- Os handlers do frontend ja possuem guard de permissao.
- O frontend chama o backend antes de iniciar ou encerrar a coleta local.
- Depois de resposta `ok`, o worker local e sincronizado com o estado aceito
  pelo backend.

Endpoints definidos pelo frontend:

```http
POST /telemetry/collection/start
POST /telemetry/collection/stop
Authorization: Bearer <token>
Content-Type: application/json
```

Permissoes exigidas:

- start: `telemetry:start`
- stop: `telemetry:stop`

Resposta minima:

```json
{
  "ok": true,
  "state": "live"
}
```

Body de start:

```json
{
  "requested_at": "2026-05-26T12:00:00.000Z"
}
```

Body de stop:

```json
{
  "requested_at": "2026-05-26T12:10:00.000Z",
  "log_start_unix": null,
  "log_stop_unix": null
}
```

O stop administrativo e chamado antes de desligar o worker local. Por isso os
bounds podem chegar como `null` nesse endpoint. Os limites reais sao enviados em
seguida para `POST /telemetry/log-session-bounds`.

Para usuario autenticado sem permissao, retornar:

```http
403 Forbidden
```

com:

```json
{
  "ok": false,
  "message": "Permissao insuficiente."
}
```

## 5. Persistencia dos limites da coleta

O frontend ja envia os bounds reais por este endpoint apos o backend aceitar o
encerramento administrativo da coleta.

Endpoint:

```http
POST /telemetry/log-session-bounds
Authorization: Bearer <token>
Content-Type: application/json
```

Permissao exigida:

```text
telemetry:stop
```

Body:

```json
{
  "log_start_unix": 1780000000.12,
  "log_stop_unix": 1780000573.44
}
```

Resposta:

```json
{
  "ok": true,
  "id": "log_2026_05_26_001",
  "status": "processing"
}
```

## 6. Erros padronizados

Para todas as rotas HTTP:

```json
{
  "ok": false,
  "message": "Mensagem legivel para a UI."
}
```

Status esperados:

- `401`: token ausente, invalido ou expirado;
- `403`: usuario autenticado sem permissao;
- `404`: log inexistente;
- `409`: estado invalido da coleta;
- `500`: erro inesperado.

## 7. Criterios de aceite

- Login de `admin` retorna permissoes administrativas.
- Login de `member` nao retorna permissoes de start/stop.
- `member` recebe `403` ao tentar start/stop, mesmo chamando API manualmente.
- `admin` consegue iniciar e encerrar coleta.
- `admin` e `member` conseguem listar e baixar logs.
- Logs com `status=processing` aparecem na listagem, mas ainda nao baixam.
- Download preserva nome, extensao e content-type definidos pelo backend.
- Operacoes administrativas e downloads ficam registrados em auditoria, se o
  backend ja tiver trilha de eventos.

## 8. Ordem recomendada para destravar o frontend

1. Atualizar `POST /login` para retornar `user.role` e `user.permissions`.
2. Implementar `GET /telemetry/logs` com pelo menos um payload real ou fixture
   persistida.
3. Implementar `GET /telemetry/logs/:id/download`.
4. Implementar `POST /telemetry/collection/start` e
   `POST /telemetry/collection/stop` com `403` para `member`.
5. Implementar `POST /telemetry/log-session-bounds`.

Depois dessa ordem, o frontend conseguira operar o fluxo completo sem ajustes
estruturais, restando apenas validacao integrada de payloads e erros reais.
