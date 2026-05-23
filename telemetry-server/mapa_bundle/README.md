# Mapa Bundle (portável)

Pasta única para copiar a lógica de mapa para outra aplicação.

## Conteúdo

- `getVelocidade.py` — velocidade por aceleração IMU (com corte de repouso).
- `mapaRegraNegocio.py` — regra de mapa (1ª volta vira mapa base + tracking).
- `getTrajetoria.py` — reconstrução de trajetória e geração de `MAPA_BASE`.
- `exportMapaFrontend.py` — export de `track_map.png` e `track_timeline.json`.
- `runPipelineMapa.py` — pipeline dedicada (velocidade → trajetória/mapa → export).

## Pré-requisitos

```bash
python3 -m pip install numpy pandas scipy matplotlib
```

## Estrutura esperada de dados

Projeto destino deve ter:

```text
data/processed/<sessao>/
```

Com sinais candump/sessão já extraídos.

## Execução recomendada

```bash
python3 runPipelineMapa.py --lap-period-sec 45 --bias-yaw-bordas-sec 3
```

Saídas por sessão:

- `TRAJETORIA_X.csv`, `TRAJETORIA_Y.csv`
- `MAPA_BASE_X.csv`, `MAPA_BASE_Y.csv` (quando possível)
- `frontend/track_map.png`
- `frontend/track_timeline.json`

