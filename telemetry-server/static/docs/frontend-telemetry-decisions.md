# Decisoes pendentes de telemetria no frontend

Este documento registra as decisoes que ainda dependem do que o time quer
extrair da telemetria real e onde os limites minimos/maximos importam no
frontend.

O objetivo e evitar que valores de UI sejam tratados como "verdade tecnica"
quando na pratica eles sao apenas defaults de operacao.

## Estado atual

Hoje o frontend ja consome:

- stream WebSocket binario com frames CAN;
- login HTTP simples para obter token;
- buffers historicos sob demanda via `requestBuffer()` no worker local;
- snapshot do ultimo valor por sinal para cards, gauges e lista de sinais.

Os pontos abaixo ainda precisam de definicao funcional e/ou validacao com dado
real continuo.

## 1. Quais sinais devem ir para cada superficie

Nem todo sinal disponivel no CAN precisa aparecer em todo lugar. Hoje a tela
esta organizada em quatro superficies:

1. `StatusBar`
2. `SignalSelector`
3. `MotecChart`
4. `Cockpit`

### 1.1 StatusBar

Arquivo base:

- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)

Decisao pendente:

- definir exatamente quais sinais sao "pinned";
- decidir se o criterio e operacional, diagnostico ou visibilidade para piloto;
- decidir se max/min/media devem valer por sessao inteira ou por janela movel.

Hoje os cards acumulam estatisticas desde que o sinal comecou a chegar no front.
Se a leitura desejada for "estatistica da ultima volta", "do stint atual" ou
"dos ultimos 30s", o comportamento precisa mudar.

### 1.2 SignalSelector

Arquivos base:

- [SignalSelector.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/SignalSelector/SignalSelector.jsx)
- [signalGrouping.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/signalGrouping.js)

Decisao pendente:

- revisar a taxonomia dos grupos;
- decidir aliases mais amigaveis para sinais crus;
- definir se alguns sinais nao devem aparecer para o operador final.

Hoje o agrupamento e heuristico, baseado no nome do sinal.

### 1.3 Graficos

Arquivos base:

- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)
- [telemetryUtils.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/telemetryUtils.js)

Decisao pendente:

- definir quais layouts default devem sempre existir;
- decidir quando usar dominio fixo e quando usar dominio dinamico;
- decidir se sinais diferentes podem coexistir no mesmo eixo Y.

Hoje o frontend assume dominio fixo para familias conhecidas e dinamico para o
resto.

### 1.4 Cockpit

Arquivos base:

- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)
- [Cockpit.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/Cockpit.jsx)

Decisao pendente:

- quais gauges precisam existir no cockpit;
- se os gauges devem representar valor instantaneo, filtrado ou suavizado;
- quais limites operacionais devem ser mostrados como normal, alerta e critico.

## 2. Onde minimos e maximos importam

Nem todo min/max tem o mesmo significado. Hoje existem pelo menos quatro tipos.

### 2.1 Escala visual do gauge

Exemplo:

- RPM A0 e RPM B0 usam `min`, `max`, `warnMax`, `critMax` em `GAUGE_CONFIG`.

Esses valores impactam:

- angulo do ponteiro;
- labels dos ticks;
- cor da faixa de alerta/critico;
- percepcao visual de "saturacao".

Definicao que o time precisa fechar:

- faixa operacional real por sinal;
- se a escala deve ser simetrica ou nao;
- se valores negativos fazem sentido visualmente no cockpit.

Hoje RPM esta com:

- `min: 0`
- `max: 10000`
- `warnMax: 8500`
- `critMax: 9500`

Esses numeros sao defaults de interface e devem ser validados com o time tecnico.

### 2.2 Dominio do eixo Y dos graficos

Arquivo base:

- [telemetryUtils.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/telemetryUtils.js)

Esses limites impactam:

- legibilidade da serie;
- espaco util do grafico;
- comparacao entre sessoes;
- risco de "achatar" a curva por causa de um dominio excessivo.

Definicao que o time precisa fechar:

- quais familias de sinal merecem dominio fixo;
- quais devem sempre autoajustar;
- se o dominio deve ser o mesmo no cockpit e na analise.

Hoje os defaults sao:

- rpm: `0..10000`
- acceleration: `-15..15`
- temperature: `0..120`
- voltage: `0..500`
- power: `-100..100`

### 2.3 Estatisticas dos cards

Arquivos base:

- [SignalCard.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/SignalCard.jsx)
- [useSignalStats.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/useSignalStats.js)

Os valores max/min/media podem significar:

- max/min/media da sessao;
- max/min/media desde o ultimo reset da UI;
- max/min/media de uma janela movel;
- max/min/media por volta.

Hoje o significado e:

- acumulado desde o inicio da sessao na UI.

Se isso nao refletir o que a equipe quer ler na operacao, esse ponto deve ser
mudado antes de considerar a superficie final.

### 2.4 Validacao de sanidade

Alguns sinais podem precisar de clamp, filtro ou deteccao de outlier antes de
virarem UI.

Isso e importante especialmente para:

- RPM
- temperatura
- tensao
- potencia
- aceleracao

Definicao que o time precisa fechar:

- quais sinais aceitam valor negativo;
- quais sinais devem ser filtrados;
- quais limites caracterizam erro de leitura e devem ser ignorados.

## 3. Perguntas que o time precisa responder

Antes de consolidar os valores definitivos no front, estas perguntas deveriam
ser respondidas:

1. Quais sinais sao prioridade operacional?
2. Quais sinais sao prioridade diagnostica?
3. O cockpit deve mostrar valores crus ou suavizados?
4. Max/min/media sao por sessao, por volta ou por janela?
5. RPM deve aceitar valores negativos em algum contexto visual?
6. Quais limites merecem faixa de alerta e critico?
7. Existem sinais que nao devem aparecer no selector final?
8. O dominio dos graficos deve ser padronizado entre eventos?

## 4. Onde editar no frontend quando essas decisoes forem fechadas

### Sinais fixos da StatusBar

- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)

### Gauges do cockpit e seus limites

- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)

### Dominio fixo dos graficos

- [telemetryUtils.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/telemetryUtils.js)

### Regras de agrupamento dos sinais

- [signalGrouping.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/signalGrouping.js)

### Semantica de max/min/media

- [useSignalStats.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/useSignalStats.js)

## 5. Recomendacao pratica

Antes de congelar a UI, vale fazer uma rodada curta com o time tecnico para
preencher uma tabela com:

- nome do sinal;
- unidade;
- faixa esperada;
- aceita negativo? sim/nao;
- usar no cockpit? sim/nao;
- usar em card fixo? sim/nao;
- usar dominio fixo no grafico? sim/nao;
- alerta em;
- critico em.

Essa tabela pode virar a origem de verdade para os arquivos de configuracao do
frontend.
