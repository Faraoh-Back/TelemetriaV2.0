# Feeds do cockpit

O Cockpit foi estruturado para receber dados do backend sem acoplar a UI a uma
implementacao especifica de streaming.

## Video onboard

Regiao na UI:

- `src/components/Cockpit/Cockpit.jsx`
- componente interno `RaceVideoPanel`
- prop prevista: `videoSource`

Opcoes provaveis de backend:

- HLS: `/streams/onboard/index.m3u8`
- MJPEG: `/streams/onboard.mjpeg`
- WebRTC: ideal para baixa latencia, mas exige componente proprio

No front, o primeiro encaixe simples seria passar:

```jsx
<Cockpit videoSource="/streams/onboard.mp4" />
```

Para HLS em browser, provavelmente sera necessario usar `hls.js` quando o
Safari nao for o alvo principal.

## Mapa da pista em tempo real

Regiao na UI:

- `src/components/Cockpit/Cockpit.jsx`
- componente interno `TrackMapPanel`
- prop prevista: `trackMapSource`

O mapa tambem deve vir do backend. A UI nao deve tentar reconstruir verdade de
posicionamento sozinha. Bons contratos possiveis:

1. Imagem pronta do backend:
   - `trackMapSource="/track/live-map.svg"`
   - mais simples para MVP
2. JSON de geometria + posicao:
   - path da pista: lista de pontos normalizados
   - posicao atual: `{ x, y, heading, speed }`
   - melhor para interatividade e overlays
3. WebSocket dedicado:
   - eventos `track.position`
   - bom para atualizar sem rebaixar o stream principal de telemetria

## Contrato sugerido para JSON

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

## Proxima implementacao de front

Quando o backend definir o formato, criar componentes separados:

- `RaceVideoFeed.jsx`
- `TrackMap.jsx`

O `Cockpit.jsx` deve continuar sendo apenas o layout/orquestrador da tela.
