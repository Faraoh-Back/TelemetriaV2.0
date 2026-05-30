# Guia de integracao do backend com o frontend

Este documento explica como o backend deve se integrar com o frontend atual da
telemetria.

O foco aqui e operacional: quais endpoints existem, qual formato de mensagem o
frontend espera e quais extensoes ainda faltam para cockpit completo.

## 1. Visao geral

Hoje o frontend espera dois tipos de integracao:

1. autenticacao HTTP para abrir a sessao;
2. stream WebSocket binario para telemetria CAN.

Adicionalmente, o cockpit ja possui pontos de extensao para:

- video onboard;
- mapa de pista;
- overlays adicionais do backend.

## 2. Descoberta de endpoint

Arquivo base:

- [serverConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/serverConfig.js)

Comportamento atual:

- o frontend usa o `hostname` atual da pagina;
- em desenvolvimento, se estiver rodando no Vite, assume backend na porta `8081`;
- o WebSocket usa `ws://host:porta/ws` ou `wss://host:porta/ws`;
- a API HTTP usa a mesma origem/porta do backend quando em producao.

## 3. Login HTTP

Fluxo esperado:

1. frontend envia credenciais;
2. backend responde com token;
3. frontend conecta no WebSocket passando esse token.

### Requisicao

`POST /login`

Payload esperado:

```json
{
  "username": "eracing",
  "password": "..."
}
```

### Resposta minima esperada

```json
{
  "ok": true,
  "token": "jwt-ou-token-equivalente"
}
```

Observacoes:

- o frontend hoje precisa do campo `token`;
- qualquer metadado extra pode ser adicionado sem quebrar o front;
- em caso de erro, o backend deve responder com status HTTP apropriado.

## 4. WebSocket de telemetria

Endpoint esperado:

- `GET /ws?token=<token>`

O frontend abre o socket logo apos login bem-sucedido.

### Validacao

O backend deve:

- validar o token antes de aceitar upgrade;
- rejeitar conexoes nao autenticadas;
- manter a conexao aberta enquanto houver stream.

### Formato binario esperado por frame

Cada frame deve ter 20 bytes fixos:

1. bytes `0..3`: `u32` little-endian com `can_id`
2. bytes `4..11`: `f64` little-endian com `timestamp`
3. bytes `12..19`: payload CAN com 8 bytes

Resumo:

```text
[ u32 can_id | f64 timestamp | u8 x 8 raw_data ]
```

### Timestamp

O timestamp deve vir em segundos Unix, compatível com `Date` no frontend depois
de multiplicar por `1000`.

Recomendacoes:

- usar timestamp monotonicamente crescente;
- evitar enviar timestamps zerados;
- manter coerencia entre fontes para alinhamento dos graficos.

## 5. Mapa CAN

O frontend hoje decodifica os sinais no worker usando um `CAN_MAP` local.

Arquivo base:

- [worker.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/workers/worker.js)

Implicacao importante:

- quando o backend mudar CAN IDs, bit positions, factor, offset ou unidades,
  o frontend precisara ser atualizado tambem.

### Recomendacao

Idealmente, o time deve manter uma fonte unica de verdade para:

- `can_id`
- `signal_name`
- `start_bit`
- `length`
- `factor`
- `offset`
- `unit`
- `signed/unsigned`

Hoje essa verdade esta espelhada manualmente no frontend.

## 6. Requisitos de qualidade do stream

Para a UI se comportar bem, o backend deve buscar:

- baixa perda de frames;
- timestamps consistentes;
- ausencia de bursts artificiais gigantes;
- fechamento limpo do socket em erro.

Se houver reconexao, o frontend tolera reconectar, mas o comportamento visual
sera melhor se o backend:

- evitar reinicializacoes excessivas;
- retomar o stream rapidamente;
- nao misturar timestamps antigos e novos fora de ordem.

## 7. Integracao do cockpit

O layout do cockpit ja existe, mas duas integracoes ainda dependem do backend.

### 7.1 Video onboard

Arquivos base:

- [Cockpit.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/Cockpit.jsx)
- [RaceVideoPanel.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/RaceVideoPanel.jsx)

O front ja aceita uma `source` para o painel.

Opcoes aceitaveis:

1. arquivo/stream MP4 simples;
2. HLS (`.m3u8`);
3. MJPEG;
4. WebRTC, se a latencia precisar ser muito baixa.

Recomendacao:

- para MVP, entregar uma URL simples de video;
- para producao operacional, avaliar HLS ou WebRTC.

### 7.2 Mapa de pista

Arquivos base:

- [Cockpit.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/Cockpit.jsx)
- [TrackMapPanel.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/TrackMapPanel.jsx)

Opcoes de contrato:

1. imagem pronta servida pelo backend;
2. JSON com geometria da pista e posicao do veiculo;
3. stream proprio de posicao.

### Contrato recomendado para JSON

```json
{
  "track": {
    "points": [[0.12, 0.44], [0.18, 0.38]],
    "bounds": { "minX": 0, "minY": 0, "maxX": 1, "maxY": 1 }
  },
  "vehicle": {
    "x": 0.58,
    "y": 0.42,
    "heading": 128.4,
    "speed": 22.1
  }
}
```

## 8. Semantica dos sinais

Alguns valores de UI dependem de interpretacao correta do backend.

Exemplos:

- sinais signed vs unsigned;
- offset aplicado no valor bruto;
- unidade final do sinal;
- faixa operacional esperada.

Isso e especialmente sensivel para:

- RPM;
- torque;
- potencia;
- aceleracoes;
- temperaturas com offset.

Se o backend alterar a forma de codificacao, o frontend precisa ser avisado.

## 9. Checklist para o time de backend

Antes da integracao final, validar:

1. existe `POST /login` retornando `token`;
2. existe `GET /ws?token=...` autenticado;
3. cada frame tem exatamente 20 bytes;
4. `can_id` esta em little-endian;
5. `timestamp` esta em `f64` little-endian;
6. payload CAN tem 8 bytes;
7. o mapa CAN usado no backend bate com o do frontend;
8. os sinais criticos do cockpit estao presentes no stream;
9. os timestamps sao coerentes ao longo do tempo;
10. em reconexao o stream volta sem reordenar frames antigos.

## 10. Proximos passos recomendados

1. Consolidar uma fonte unica de verdade do mapa CAN.
2. Definir contrato final de video onboard.
3. Definir contrato final de mapa de pista.
4. Validar faixas reais de operacao para RPM, temperatura, tensao e potencia.
5. Rodar um teste continuo com stream real para observar desempenho e qualidade
   do dado por varios minutos.
