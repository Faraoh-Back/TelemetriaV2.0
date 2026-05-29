# Processamento backend: admin e member

Este documento descreve a separacao de perfis aplicada no backend.

## Perfis

- `admin`: pode iniciar coleta, encerrar coleta e consumir dados/logs.
- `member`: pode consumir dados/logs, mas nao pode iniciar nem encerrar coleta.

Permissoes derivadas:

```text
admin  -> telemetry:start, telemetry:stop, logs:read, logs:download
member -> logs:read, logs:download
```

## Banco de usuarios

A tabela `users` passa a ter a coluna:

```sql
role TEXT NOT NULL DEFAULT 'member'
```

Usuarios existentes recebem `member` por padrao. Durante a inicializacao do
backend, usernames `admin`, `adm` e `administrador` sao promovidos para
`admin` se ainda estiverem como `member`.

Para promover outro usuario manualmente:

```sql
UPDATE users SET role = 'admin' WHERE username = '<usuario>';
```

## Login

`POST /login` agora retorna o perfil e as permissoes no corpo da resposta:

```json
{
  "ok": true,
  "token": "jwt",
  "user": {
    "username": "admin",
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

O JWT tambem carrega `role` e `permissions`. Tokens antigos sem esses campos
sao tratados como `member`, para evitar acesso administrativo implicito.

## Rotas administrativas

As rotas abaixo exigem permissao administrativa:

```text
POST /telemetry/collection/start -> telemetry:start
POST /telemetry/collection/stop -> telemetry:stop
POST /telemetry/log-session-bounds -> telemetry:stop
```

Comportamento:

- sem token ou token invalido: `401`;
- token valido sem permissao: `403`;
- token `admin`: operacao segue o fluxo normal;
- token `member`: recebe `403` mesmo chamando a API manualmente.

## Observacao

A UI tambem esconde controles administrativos para `member`, mas o bloqueio
real fica no backend.
