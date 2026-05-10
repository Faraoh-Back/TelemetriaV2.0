# Grafico padrao de historico relativo por RPM

## Objetivo

Criar uma superficie de analise em que o RPM seja o sinal de referencia para
todo o historico capturado na sessao. O eixo X deixa de representar horario real
e passa a representar tempo relativo:

- `00:00.000` = primeiro frame valido recebido pela telemetria na sessao;
- `stop` = ultimo frame valido disponivel no buffer local;
- a janela selecionada no historico vira o contexto para consultar outros
  sinais naquele mesmo instante de analise.

## Comportamento esperado

1. Exibir um grafico padrao fixo no topo da aba `Analise`.
2. Plotar os sinais de RPM como referencia:
   - `act_Speed_A0`
   - `act_Speed_B0`
   - `act_Speed_A13`
   - `act_Speed_B13`
3. Converter o eixo X de timestamp Unix para segundos relativos ao boot da
   sessao.
4. Permitir arrastar uma janela no grafico para marcar o trecho de interesse.
5. Usar o cursor/janela selecionada para consultar os valores dos sinais
   selecionados no `SignalSelector`.
6. Calcular resumo da janela selecionada por sinal: minimo, media, maximo e
   quantidade de amostras.
7. Plotar um grafico detalhado dos sinais selecionados recortado na janela
   arrastada.
8. Permitir inicio/fim da coleta pelo frontend sem encerrar a sessao autenticada.
9. Manter os graficos existentes por janela movel para nao quebrar a operacao
   atual.

## Passo a passo de implementacao

### 1. Base de dados

- Reutilizar os buffers historicos ja mantidos pelo worker.
- Buscar o historico completo usando `requestBuffer(name, threshold, null)`.
- Calcular `boot` como o menor timestamp inicial entre os sinais carregados.
- Calcular `stop` como o maior timestamp final entre os sinais carregados.
- Converter o eixo X para `timestamp - boot`.

### 2. Grafico de referencia

- Criar `HistoryReferenceChart`.
- Reutilizar `uPlot` e a configuracao visual existente.
- Adicionar suporte a eixo X relativo em `buildUPlotOptions`.
- Registrar `setCursor` para obter o tempo relativo sob o cursor.
- Registrar `setSelect` para obter a janela arrastada pelo usuario.

### 3. Leitura contextual de sinais

- Carregar, alem dos RPMs, os sinais selecionados pelo usuario.
- Para cada sinal selecionado, buscar a amostra mais proxima do timestamp
  absoluto equivalente ao cursor.
- Mostrar valor, unidade e tempo relativo da amostra encontrada.

### 4. Integracao inicial

- Inserir o novo grafico como primeiro bloco da `chart-area`.
- Manter `TimeWindowControl` controlando apenas os graficos moveis atuais.
- Usar a selecao do `SignalSelector` como lista de sinais de comparacao.
- Expor `Iniciar coleta` / `Encerrar coleta` na `TopBar`.
- Enquanto a coleta esta em tempo real, mostrar apenas graficos moveis padrao.
- Durante a coleta, todos os graficos usam tempo relativo ao boot da sessao,
  nao horario absoluto.
- Quando a coleta e encerrada, congelar os buffers locais e mostrar o grafico
  historico relativo por RPM.

### 5. Estados da tela

- `idle`: usuario autenticado e conexao pronta, mas nenhuma coleta ativa.
- `live`: coleta em tempo real; foco em operacao, cards e graficos moveis.
- `stopped`: coleta encerrada; foco em historico, selecao de janela e analise.

Nesta primeira versao, o frontend congela a coleta no worker local sem fechar o
WebSocket. Quando o backend tiver contrato proprio para iniciar/pausar envio, o
mesmo botao deve chamar esse comando em vez de apenas controlar a coleta local.

### 6. Armazenamento e logs para analise posterior

Objetivo: cada periodo entre `Iniciar coleta` e `Encerrar coleta` deve virar uma
sessao historica consultavel depois.

Modelo recomendado:

- `telemetry_sessions`
  - `id`
  - `started_at`
  - `stopped_at`
  - `driver` ou `operator`
  - `car_id`
  - `notes`
  - `status`: `recording`, `closed`, `archived`
- `telemetry_samples`
  - `session_id`
  - `timestamp_abs`
  - `timestamp_rel`
  - `can_id`
  - `signal_name`
  - `value`
  - `unit`

Fluxo recomendado:

1. `Iniciar coleta` cria uma nova sessao no backend.
2. Backend continua recebendo frames do carro e grava cada amostra com
   `session_id`.
3. `timestamp_rel` e calculado como `timestamp_abs - started_at`.
4. `Encerrar coleta` marca `stopped_at` e fecha a sessao.
5. O frontend pode carregar a sessao fechada por id e reconstruir o grafico de
   RPM completo, sem depender do buffer local.

Para performance:

- manter dados brutos completos para auditoria;
- gerar downsample/cache por sessao para graficos longos;
- permitir consulta por faixa relativa: `session_id + start_seconds + end_seconds`;
- retornar estatisticas agregadas da janela quando o usuario arrastar um trecho.

### 7. Evolucoes recomendadas

- Persistir sessoes historicas no backend para analisar stints antigos, nao
  apenas o buffer local em memoria.
- Criar zoom por janela selecionada, com graficos derivados mostrando apenas o
  trecho marcado.
- Adicionar estatisticas da janela: min, max, media e delta por sinal.
- Permitir escolher qual RPM e o canal de referencia principal.
- Marcar eventos de boot/stop, falhas e voltas quando esses metadados existirem.

## Estado da primeira entrega

Implementado:

- componente `HistoryReferenceChart`;
- componentes dedicados para grafico de RPM, grafico da janela e tabela de
  estatisticas;
- eixo X relativo em `chartOptions`;
- helpers para limites de historico e busca de amostra mais proxima;
- integracao na aba `Analise`;
- exibicao de cursor, janela selecionada e valores dos sinais selecionados.
- resumo da janela selecionada com min, media, max e quantidade de amostras.
- grafico detalhado dos sinais selecionados dentro da janela arrastada.
- fluxo de tela `idle` / `live` / `stopped`.
- botao `Iniciar coleta` / `Encerrar coleta`, sem logout e sem fechar o
  WebSocket.
- eixo relativo tambem nos graficos ao vivo, usando a primeira amostra da coleta
  como boot.

Ainda nao implementado:

- persistencia backend de sessoes historicas;
- contrato backend para iniciar/pausar envio real por sessao;
- zoom/subgraficos sincronizados pela janela selecionada.
