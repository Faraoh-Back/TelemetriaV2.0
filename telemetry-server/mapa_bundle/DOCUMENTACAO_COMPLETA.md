# Mapa Bundle — Documentação Completa

## 1. Objetivo

Este bundle concentra a lógica de negócio para:

1. estimar velocidade a partir de aceleração IMU;
2. reconstruir trajetória 2D no plano da pista;
3. definir mapa base pela primeira volta;
4. rastrear a posição do carro no mapa fixo;
5. exportar artefatos para frontend.

O foco é validar e operacionalizar a regra:

- **primeira volta define o mapa**;
- **voltas seguintes não redesenham pista**;
- **posição é projetada no mapa base por progresso**.

---

## 2. Escopo deste bundle

Arquivos:

- `getVelocidade.py`
- `mapaRegraNegocio.py`
- `getTrajetoria.py`
- `exportMapaFrontend.py`
- `runPipelineMapa.py`
- `README.md`

Este pacote é portável para outra aplicação, desde que ela respeite a estrutura esperada de dados em `data/processed`.

---

## 3. Arquitetura funcional

## 3.1 Fluxo macro

1. **ACC → VEL** (`getVelocidade.py`)
2. **VEL + YAW (+RPM quando houver) → X,Y** (`getTrajetoria.py`)
3. **Regra de mapa** (`mapaRegraNegocio.py`)
4. **Export frontend** (`exportMapaFrontend.py`)

## 3.2 Responsabilidade de cada módulo

### `getVelocidade.py`

Integra aceleração em velocidade com:

- correção de bias;
- filtro Butterworth;
- detecção de janela de movimento (remove trecho parado no início/fim);
- integração trapezoidal;
- compensação de drift residual (quando aplicável).

Saídas típicas:

- `VENTOR_LINEAR_VEL_X.csv`
- `VENTOR_LINEAR_VEL_Y.csv`

### `mapaRegraNegocio.py`

Implementa a regra de negócio do mapa:

- estima período de volta por autocorrelação da velocidade;
- congela a primeira volta em `MAPA_BASE`;
- calcula tracking por progresso escalar sobre a polilinha fixa.

### `getTrajetoria.py`

Reconstrói `TRAJETORIA_X/Y` usando:

- modo preferencial: `RPM + ACC_X + YAW`;
- fallback: `VEL_X/VEL_Y + YAW`.

Quando possível, gera também:

- `MAPA_BASE_X.csv`
- `MAPA_BASE_Y.csv`

### `exportMapaFrontend.py`

Exporta por sessão:

- `frontend/track_map.png` (mapa para painel que usa imagem);
- `frontend/track_timeline.json` (timeline de posição para evolução realtime).

### `runPipelineMapa.py`

Orquestra o fluxo dedicado:

- velocidade;
- trajetória/mapa;
- export frontend.

---

## 4. Dados de entrada esperados

## 4.1 Estrutura de diretórios

```text
data/processed/<sessao>/
```

## 4.2 Sinais mínimos para trajetória

Obrigatório:

- `VENTOR_ANGULAR_SPEED_Z.csv`

E um dos conjuntos:

1. **preferencial**
- `ACT_SPEED_A13.csv` e/ou `ACT_SPEED_B13.csv`
- `VENTOR_LINEAR_ACC_X.csv`

2. **fallback**
- `VENTOR_LINEAR_VEL_X.csv` ou `VENTOR_LINEAR_VEL_Y.csv`

## 4.3 Formato CSV esperado

Colunas:

- `names`
- `timestamp`
- `id_can`
- `prioridade`
- `dado` (valor + unidade, ex. `-0.15 m/s²`)

---

## 5. Processo operacional recomendado

## 5.1 Comando único

```bash
python3 runPipelineMapa.py --lap-period-sec 45 --bias-yaw-bordas-sec 3
```

## 5.2 Passo a passo equivalente

```bash
python3 getVelocidade.py data/processed/**/VENTOR_LINEAR_ACC_*.csv
python3 getTrajetoria.py data/processed/candump-* --lap-period-sec 45 --bias-yaw-bordas-sec 3
python3 exportMapaFrontend.py
```

## 5.3 Quando ajustar parâmetros

- `--lap-period-sec T`: usar quando auto-detecção de volta falhar.
- `--bias-yaw-bordas-sec S`: usar quando houver repouso real no início/fim da sessão.

---

## 6. Regra de negócio do mapa (definição oficial)

1. Integrar trajetória bruta `x,y`.
2. Estimar (ou receber) período de volta `T_lap`.
3. Recortar primeira volta completa.
4. Fechar/reamostrar polilinha para gerar `MAPA_BASE`.
5. A partir daí:
- não gerar nova geometria de pista;
- projetar posição por progresso no mapa fixo.

Resumo:

- **mapa = geometria da primeira volta**
- **tracking = posição instantânea no mapa**

---

## 7. Validacao com dados reais

A validacao desta etapa deve usar logs reais de bancada ou pista.

---

## 8. Resultados esperados por sessão real

Arquivos esperados:

- `TRAJETORIA_X.csv`
- `TRAJETORIA_Y.csv`
- `MAPA_BASE_X.csv` e `MAPA_BASE_Y.csv` (quando sessão for válida para mapa)
- `frontend/track_map.png`
- `frontend/track_timeline.json`

No log do `getTrajetoria.py`, esperar:

- `Mapa/Tracking : mapa fixo da 1ª volta (...)` quando válido;
- ou mensagem de motivo técnico quando não possível.

---

## 9. Motivos de falha mais comuns

## 9.1 Auto-detecção de volta falha

Mensagens:

- `pico_autocorr_fraco`
- `duracao_ou_fs_insuficiente`

Ação:

- forçar `--lap-period-sec`.

## 9.2 Sessão longa sem mapa base

Causa comum:

- janela útil curta na **grade comum** (interseção temporal entre sinais),
mesmo com arquivo bruto longo.

Ação:

- revisar sobreposição de timestamps;
- revisar recorte da sessão;
- usar período fixo por sessão.

## 9.3 Sessão curta/incompleta

Mensagem:

- `duracao_curta_para_multiplas_voltas`

Ação:

- sem mapa base para essa sessão;
- manter fallback de trajetória.

---

## 10. Critérios de aceite antes da integração em aplicação final

1. Velocidade por ACC com corte de parado coerente no log.
2. `MAPA_BASE` gerado nas sessões com dados suficientes.
3. Tracking não redesenha pista a cada volta.
4. Export frontend gerado por sessão.
5. Validação com log real de bancada ou pista.

---

## 11. Contrato de export para frontend

## 11.1 `track_map.png`

- imagem estática do mapa da sessão;
- preferencialmente derivada de `MAPA_BASE`.

## 11.2 `track_timeline.json`

Campos principais:

- `session`
- `mapSource` (`MAPA_BASE` ou `TRAJETORIA_FALLBACK`)
- `track.points` (normalizado)
- `track.bounds` (escala real)
- `timeline[].vehicle.{x,y}` (posição normalizada no tempo)

---

## 12. Limitações atuais

1. Não é pipeline realtime ainda (orientada a pós-processamento por sessão).
2. Qualidade depende fortemente da qualidade/sincronização dos sinais.
3. Sem `MAPA_BASE`, export usa fallback de trajetória (menos robusto).

---

## 13. Próximo passo (integração)

Com este bundle validado:

1. plugar no backend da aplicação final;
2. trocar batch por atualização incremental;
3. servir mapa e posição em endpoint/stream realtime.

Este documento encerra a fase de validação da regra de negócio e prepara a fase de integração.
