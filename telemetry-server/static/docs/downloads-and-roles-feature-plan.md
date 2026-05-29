# Plano de feature: Downloads de logs e perfis de acesso

Este documento planeja a implementacao de uma nova aba de downloads na
telemetria e a separacao entre dois perfis de usuario:

- `admin`: pode iniciar coleta, encerrar coleta e consumir dados/logs.
- `member`: pode consumir dados/logs, mas nao pode iniciar nem encerrar coleta.

O objetivo e deixar a arquitetura pronta para o backend definir os formatos
finais dos arquivos de log, sem amarrar o frontend a CSV, JSON, binario, MoTeC
ou qualquer outro formato especifico.

## 1. Contexto atual

Arquivos principais ja existentes:

- [src/App.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/App.jsx)
- [src/components/TopBar/TopBar.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/TopBar/TopBar.jsx)
- [src/components/TabBar/TabBar.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/TabBar/TabBar.jsx)
- [src/utils/auth.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/auth.js)
- [src/services/telemetryCollection.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/services/telemetryCollection.js)
- [src/config/serverConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/serverConfig.js)

Hoje:

- `App.jsx` controla sessao, aba ativa e modo de telemetria.
- `TopBar.jsx` renderiza o botao de iniciar/encerrar coleta.
- `TabBar.jsx` recebe uma lista estatica de abas.
- `auth.js` guarda apenas o token e valida expiracao.
- A coleta e habilitada localmente via worker com `setTelemetryCollectionEnabled`.
- Start/stop e persistencia dos limites da coleta passam por
  `telemetryCollection.js` antes de sincronizar o estado local.

## 2. Escopo funcional

### 2.1 Nova aba `Downloads`

A nova aba deve permitir:

1. listar logs disponiveis;
2. filtrar logs por periodo, tipo/formato, status e texto;
3. visualizar metadados basicos de cada log;
4. baixar cada log no formato entregue pelo backend;
5. atualizar manualmente a lista;
6. indicar estados de carregamento, erro, lista vazia e download em andamento.

O frontend nao deve converter o arquivo no MVP. Ele deve respeitar:

- `download_url`, quando o backend entregar URL direta;
- ou endpoint de download autenticado, quando o backend exigir header
  `Authorization`.

### 2.2 Perfis de acesso

Perfis:

| Perfil | Iniciar coleta | Encerrar coleta | Ver analise | Ver cockpit | Ver downloads | Baixar logs |
| --- | --- | --- | --- | --- | --- | --- |
| `admin` | Sim | Sim | Sim | Sim | Sim | Sim |
| `member` | Nao | Nao | Sim | Sim | Sim | Sim |

Regras de produto:

- O membro deve conseguir acompanhar telemetria e consumir logs.
- O membro nao deve ver comandos que parecam acionaveis para iniciar/encerrar
  coleta.
- Mesmo que a UI esconda o botao, o backend precisa bloquear essas operacoes
  para usuarios sem permissao.

## 3. Arquitetura proposta

### 3.1 Modelo de sessao no frontend

Expandir a sessao atual de:

```js
{ token, username, mode: 'live' }
```

para:

```js
{
  token: string,
  username: string,
  role: 'admin' | 'member',
  permissions: string[],
  mode: 'live'
}
```

Permissoes recomendadas:

```js
const PERMISSIONS = {
  telemetryStart: 'telemetry:start',
  telemetryStop: 'telemetry:stop',
  logsRead: 'logs:read',
  logsDownload: 'logs:download',
}
```

O frontend pode derivar `canStartTelemetry`, `canStopTelemetry`,
`canReadLogs` e `canDownloadLogs` a partir de `permissions`.

### 3.2 Autenticacao e claims

O backend deve retornar o perfil no login. Existem duas opcoes aceitaveis:

Opcao A, resposta explicita:

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

Opcao B, claims dentro do JWT:

```json
{
  "sub": "joao",
  "role": "admin",
  "permissions": [
    "telemetry:start",
    "telemetry:stop",
    "logs:read",
    "logs:download"
  ],
  "exp": 1780000000
}
```

Recomendacao: usar as duas abordagens quando possivel. A resposta explicita
facilita a UI; o JWT continua sendo a fonte de verdade para autorizacao no
backend.

### 3.3 Navegacao

Adicionar uma terceira aba em `App.jsx`:

```js
const TABS = [
  { id: 'analise', label: 'Analise' },
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'downloads', label: 'Downloads' },
]
```

Renderizacao esperada:

- `analise`: fluxo atual de graficos e historico.
- `cockpit`: fluxo atual do cockpit.
- `downloads`: novo componente `DownloadsPage`.

### 3.4 Controle de coleta

Alterar `TopBar` para receber permissao:

```jsx
<TopBar
  canControlTelemetry={canControlTelemetry()}
  ...
/>
```

Comportamento:

- `admin`: mostra controle de coleta normalmente.
- `member`: mostra somente status da coleta/conexao, sem botao de iniciar ou
  encerrar.

Opcional para uma segunda etapa:

- Mostrar tooltip ou texto curto no hover: `Controle restrito a administradores`.
- Nao colocar esse texto como explicacao permanente na UI principal.

### 3.5 Modulos novos

Criar:

```text
src/components/Downloads/DownloadsPage.jsx
src/components/Downloads/DownloadsPage.css
src/components/Downloads/DownloadFilters.jsx
src/components/Downloads/DownloadLogTable.jsx
src/components/Downloads/DownloadStatusBadge.jsx
src/services/logDownloads.js
src/utils/permissions.js
```

Responsabilidades:

- `DownloadsPage.jsx`: orquestra filtros, carregamento e download.
- `DownloadFilters.jsx`: filtros de busca/periodo/tipo/status.
- `DownloadLogTable.jsx`: lista os logs e botoes de download.
- `DownloadStatusBadge.jsx`: padroniza estados como `ready`, `processing`,
  `failed` e `expired`.
- `logDownloads.js`: encapsula `fetch` dos endpoints de logs.
- `permissions.js`: centraliza nomes de permissoes e helpers `hasPermission`.

## 4. Contrato backend proposto

### 4.1 Listar logs

Endpoint:

```http
GET /telemetry/logs
Authorization: Bearer <token>
```

Query params opcionais:

```text
from=<unix_seconds_or_iso>
to=<unix_seconds_or_iso>
type=<raw|csv|json|motec|other>
status=<ready|processing|failed|expired>
q=<texto>
limit=50
cursor=<cursor>
```

Resposta:

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

Observacoes:

- `format` e `content_type` sao metadados; o frontend nao deve presumir
  extensao fixa.
- `download_url` pode ser `null` se o download exigir rota autenticada.
- `metadata` e livre para o backend evoluir sem quebrar a UI.

### 4.2 Baixar log autenticado

Endpoint:

```http
GET /telemetry/logs/:id/download
Authorization: Bearer <token>
```

Resposta:

- corpo binario ou texto do arquivo;
- `Content-Type` real do arquivo;
- `Content-Disposition: attachment; filename="nome.ext"`.

O frontend deve usar `Blob` e criar um link temporario para download quando
precisar enviar headers. Se `download_url` ja vier pronto, pode abrir a URL
diretamente.

### 4.3 Criacao do log ao encerrar coleta

O frontend envia os limites da coleta por `telemetryCollection.js` depois que o
backend aceita o encerramento administrativo e o worker local retorna os bounds.

Endpoint recomendado:

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

Resposta:

```json
{
  "ok": true,
  "id": "log_2026_05_26_001",
  "status": "processing"
}
```

Esse endpoint deve ser permitido apenas para `admin`, porque ele faz parte do
fluxo de encerramento da coleta.

### 4.4 Start/stop no backend

O frontend chama comandos administrativos HTTP antes de alterar o estado local
da coleta. O backend deve tratar esses endpoints como o contrato oficial de
autorizacao.

Endpoints definidos pelo frontend:

```http
POST /telemetry/collection/start
POST /telemetry/collection/stop
Authorization: Bearer <token>
Content-Type: application/json
```

Semantica:

- `admin`: autorizado.
- `member`: `403 Forbidden`.
- Backend registra auditoria com usuario, horario e origem.

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

No fluxo atual, `stop` e chamado antes de desligar a coleta local; por isso os
bounds seguem como `null` nesse endpoint e sao enviados em seguida para
`POST /telemetry/log-session-bounds`.

## 5. UX da aba Downloads

### 5.1 Layout

Primeira versao:

- cabecalho compacto com titulo `Downloads`;
- botao de atualizar;
- filtros em uma barra unica;
- tabela/lista de logs;
- acoes por linha.

Colunas sugeridas:

- Nome
- Inicio
- Fim
- Duracao
- Formato
- Tamanho
- Status
- Acao

Estados:

- carregando: skeleton ou mensagem curta;
- vazio: mensagem operacional indicando que nao ha logs para os filtros;
- erro: mensagem com botao de tentar novamente;
- `processing`: linha visivel, download desabilitado;
- `failed` ou `expired`: linha visivel com status claro e sem download.

### 5.2 Download

Fluxo:

1. usuario clica em baixar;
2. UI marca somente aquela linha como `downloading`;
3. `logDownloads.js` chama rota autenticada ou usa `download_url`;
4. browser inicia download com nome vindo do backend;
5. em erro, a linha mostra falha temporaria e permite tentar de novo.

## 6. Seguranca e autorizacao

Regras obrigatorias no backend:

1. validar JWT em todas as rotas de logs;
2. exigir `logs:read` para listar logs;
3. exigir `logs:download` para baixar logs;
4. exigir `telemetry:start` para iniciar coleta;
5. exigir `telemetry:stop` para encerrar coleta;
6. retornar `403` quando autenticado mas sem permissao;
7. nao confiar em permissao enviada pelo frontend;
8. registrar auditoria para start/stop e download, se possivel.

Regras no frontend:

1. esconder controles administrativos para `member`;
2. desabilitar acoes quando permissao estiver ausente;
3. tratar `401` limpando sessao e voltando ao login;
4. tratar `403` mostrando erro de permissao;
5. manter o token fora de logs de console.

## 7. Plano de execucao

Status atualizado: o frontend ja cobre sessao com perfil, guards de
`admin/member`, aba `Downloads`, services HTTP para logs, start/stop
administrativo, persistencia de bounds e proxy de desenvolvimento para
`/telemetry`. O backend deve se adequar aos contratos definidos aqui e nas
pendencias documentadas em
[backend-downloads-and-roles-pending.md](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/backend-downloads-and-roles-pending.md).

### Fase 1: Modelo de sessao e permissoes

1. Concluido: criar `src/utils/permissions.js`.
2. Concluido: atualizar `auth.js` para extrair `role` e `permissions` da resposta de login
   ou do JWT.
3. Concluido: atualizar `App.jsx` para guardar `role` e `permissions` na sessao.
4. Concluido: garantir fallback temporario para tokens antigos:
   - em desenvolvimento, assumir `admin` quando nao houver role;
   - em producao, preferir role `member` ou bloquear operacoes sensiveis.

### Fase 2: Controle administrativo de coleta

1. Concluido: adicionar `canControlTelemetry` e permissoes separadas em `App.jsx`.
2. Concluido: passar a permissao para `TopBar`.
3. Concluido: esconder o botao de iniciar/encerrar para `member`.
4. Concluido: proteger handlers `handleStartTelemetry` e `handleStopTelemetry` com guards
   de permissao.
5. Concluido no frontend: criar service para os comandos
   `POST /telemetry/collection/start` e `POST /telemetry/collection/stop`.
6. Concluido no frontend: sincronizar o estado local da coleta com a resposta
   real do backend.
7. Pendente de validacao integrada: testar `401`, `403` e `409` contra backend
   real.

### Fase 3: Aba Downloads

1. Concluido: adicionar aba `downloads` ao `TABS`.
2. Concluido: criar `DownloadsPage` e CSS.
3. Concluido: criar `logDownloads.js` com:
   - `listTelemetryLogs(filters, token)`;
   - `downloadTelemetryLog(log, token)`.
4. Concluido: implementar tabela/lista com estados de carregamento, erro e vazio.
5. Concluido: implementar download por `Blob` para rota autenticada.
6. Concluido: respeitar `download_url` quando o backend enviar URL assinada.
7. Pendente apos backend: validar a tabela com payload real e ajustar somente
   detalhes de campos se o contrato final mudar.

### Fase 4: Integracao com backend

1. Documentado para backend: definir contrato final dos endpoints.
2. Concluido no frontend: atualizar `vite.config.js` com proxy `/telemetry`.
3. Concluido no frontend: enviar bounds reais para `/telemetry/log-session-bounds`.
4. Concluido no backend: implementar start/stop administrativo e
   `/telemetry/log-session-bounds` para persistir timestamps da coleta. Ver
   [backend-collection-timestamps.md](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/backend-collection-timestamps.md).
5. Pendente no frontend apos backend: validar com logs reais de formatos
   diferentes.
6. Pendente no frontend apos backend: consolidar tratamento global de `401` e
   `403` nos services autenticados.

### Fase 5: Testes e validacao

1. Testar login como `admin`:
   - ve botao de coleta;
   - inicia coleta;
   - encerra coleta;
   - visualiza e baixa logs.
2. Testar login como `member`:
   - nao ve controle acionavel de coleta;
   - acessa analise, cockpit e downloads;
   - baixa logs permitidos.
3. Testar `403` forjado:
   - chamar download sem permissao;
   - chamar start/stop sem permissao.
4. Testar lista vazia, erro de rede e download de arquivo grande.
5. Rodar build do frontend.

## 8. Riscos e decisoes pendentes

### Riscos

- Se o backend nao aplicar `403` nos endpoints administrativos, um usuario
  tecnico ainda pode tentar contornar a UI.
- Logs grandes podem consumir memoria se o download autenticado usar `Blob`.
  Para arquivos muito grandes, preferir URL assinada/temporaria servida pelo
  backend ou storage.
- Se o backend nao enviar `Content-Disposition`, o frontend precisara inferir
  nome e extensao por metadados.
- Tokens antigos sem `role` podem criar comportamento inconsistente se nao
  houver fallback definido.

### Decisoes pendentes

1. O backend vai devolver `role/permissions` no corpo do login, no JWT ou ambos?
2. Os logs serao baixados por URL assinada ou por endpoint autenticado?
3. Quais formatos iniciais precisam aparecer no filtro?
4. O backend aceitara o contrato HTTP de start/stop definido pelo frontend?
5. O membro pode ver todos os logs ou apenas logs de determinado escopo?
6. Havera auditoria de downloads?

## 9. Checklist de implementacao

- [x] Documentar plano de arquitetura da feature.
- [x] Documentar pendencias do backend em arquivo dedicado.
- [x] Criar helper de permissoes no frontend.
- [x] Atualizar sessao em `App.jsx`.
- [x] Bloquear start/stop para `member` na UI e nos handlers.
- [x] Adicionar aba `Downloads`.
- [x] Criar componentes da area de downloads.
- [x] Criar service HTTP para listar e baixar logs.
- [x] Implementar estados de loading/empty/error/downloading.
- [x] Respeitar download autenticado por `Blob`.
- [x] Respeitar `download_url` quando backend enviar URL pronta.
- [x] Atualizar proxy de desenvolvimento para `/telemetry`.
- [ ] Backend: definir contrato final de login com perfil/permissoes.
- [x] Frontend: criar service de start/stop administrativo.
- [x] Frontend: sincronizar start/stop local com resposta real do backend.
- [x] Frontend: substituir mock de persistencia de bounds por chamada real.
- [ ] Backend: implementar autorizacao real para start/stop.
- [ ] Backend: implementar listagem e download de logs.
- [x] Backend: implementar persistencia de bounds da coleta.
- [ ] Frontend: consolidar tratamento de `401`, `403` e `409` nos services.
- [ ] Frontend: validar payload real de logs e ajustar campos se necessario.
- [ ] Validar backend com `401`, `403`, arquivo pequeno e arquivo grande.
- [ ] Atualizar documentacao principal se a feature entrar em producao.
