# Correcao do offset visual dos gauges

Os gauges sao desenhados em duas camadas de canvas:

- `src/components/Gauge/Gauge.jsx`: define tamanho e geometria base.
- `src/components/Gauge/gaugeCanvas.js`: desenha fundo, ticks, labels, ponteiro e valor.
- `src/components/Gauge/gaugeUtils.js`: concentra angulos, cores e conversao de valor.

## Problema observado

Em escalas grandes, principalmente `-32000..32000`, os labels dos ticks ficam
visualmente deslocados e competem com o valor central. O resultado parece um
offset da imagem, mas a causa mais provavel e geometria/texto:

- labels muito grandes para o raio do gauge;
- labels posicionados perto demais do centro;
- valor central e unidade ocupando a mesma regiao que alguns ticks;
- todos os ticks renderizados mesmo quando a escala tem numeros longos.

## Caminho implementado

1. Foi criada a funcao pura `getGaugeLayout(size, min, max)` em `gaugeUtils.js`.
2. Foram centralizados nela:
   - raio externo;
   - raio do arco;
   - raio dos ticks;
   - raio dos labels;
   - tamanho da fonte dos labels;
   - posicao do valor central;
   - posicao da unidade.
3. `drawStatic()` e `drawDynamic()` agora consomem esse layout, em vez de
   multiplicadores soltos como `r * 0.62` ou `r * 0.28`.
4. Foi adicionada uma regra para escalas com labels longos:
   - reduzir fonte dos ticks;
   - trazer labels para um raio mais interno;
   - formatar `-32000` como `-32k`.
5. Gauges sem sinal agora mostram `--`, sem ponteiro apontando para o minimo.

## Validacao pendente

Validar com screenshot para estes casos:

   - `-32000..32000` rpm;
   - `0..100` %;
   - uma escala curta, por exemplo `0..12`.

Se ainda houver colisao em escala grande, o proximo ajuste deve ser alternar
labels intermediarios ou diminuir `tickLabelRadius` somente para gauges compactos.
