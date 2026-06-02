# Telemetria V2 — Módulo de Comunicação de Voz com o Piloto

**Equipe:** E-Racing UNICAMP — Formula SAE Electric  
**Versão:** 2.0  
**Data:** Março 2026  
**Autor:** Cairê / Telemetria V2 Team

---

## Índice

1. [Visão Geral e Motivação](#1-visão-geral-e-motivação)
2. [Por que Comunicação Bidirecional?](#2-por-que-comunicação-bidirecional)
3. [Protocolo de Comunicação — Mesh 3.0 EJEAS](#3-protocolo-de-comunicação--mesh-30-ejeas)
4. [Hardware Escolhido e Justificativa](#4-hardware-escolhido-e-justificativa)
5. [Arquitetura Física Completa](#5-arquitetura-física-completa)
6. [Alimentação do Q8 Base no Painel](#6-alimentação-do-q8-base-no-painel)
7. [Mapeamento de Pinos USB-C](#7-mapeamento-de-pinos-usb-c)
8. [Montagem do Circuito](#8-montagem-do-circuito)
9. [Integração com a Jetson AGX Xavier](#9-integração-com-a-jetson-agx-xavier)
10. [A Stack de Áudio — ALSA, cpal e Opus explicados](#10-a-stack-de-áudio--alsa-cpal-e-opus-explicados)
11. [Protocolo de Transporte — Por que UDP+RTP e não WebRTC](#11-protocolo-de-transporte--por-que-udprtp-e-não-webrtc)
12. [Largura de Banda e Uso de Rede](#12-largura-de-banda-e-uso-de-rede)
13. [Latência — Análise por Trecho](#13-latência--análise-por-trecho)
14. [Backup de Áudio](#14-backup-de-áudio)
15. [Fluxo Completo de Dados — ponta a ponta](#15-fluxo-completo-de-dados--ponta-a-ponta)
16. [Integração com o telemetry-server (Rust)](#16-integração-com-o-telemetry-server-rust)
17. [Lista de Materiais](#17-lista-de-materiais)
18. [Checklist de Implementação](#18-checklist-de-implementação)

---

## 1. Visão Geral e Motivação

O sistema de comunicação de voz é o **módulo V2.3** da arquitetura Telemetria V2, responsável por estabelecer um canal de voz em tempo real, bidirecional e com backup, entre o piloto dentro do carro e a equipe no pit lane.

### Requisito central — piloto sem fios

Em competições Formula SAE, o piloto precisa conseguir **sair rapidamente do carro em caso de emergência**. Qualquer cabo conectado ao capacete ou ao corpo do piloto representa um risco real. Por isso, a arquitetura foi projetada com a premissa inegociável:

> **O piloto não pode ter nenhum cabo físico conectado ao carro.**

Isso elimina soluções com headset com fio, push-to-talk cabeado ou qualquer intercom tradicional de cockpit. A comunicação sem fio entre o capacete e uma base fixa no painel é a única arquitetura viável.

### O que o sistema entrega

- Comunicação de voz **full-duplex** (bidirecional simultânea) entre piloto e engenheiro
- **Latência de ~51–75ms** — imperceptível para conversa humana
- **Backup automático** de todos os áudios da corrida na Jetson e no servidor
- **Uso negligenciável de rede** — menos de 0,1% da banda disponível
- Integração limpa com o `telemetry-server` Rust já existente

---

## 2. Por que Comunicação Bidirecional?

### O que é comunicação unidirecional

Em sistemas unidirecionais, o áudio flui em apenas **uma direção por vez**. O modelo clássico é o walkie-talkie com push-to-talk — um lado fala, o outro escuta, depois invertem. Nunca os dois falam ao mesmo tempo.

**Limitações para o contexto de corrida:**
- O engenheiro não consegue interromper o piloto em situações críticas de segurança
- Não há confirmação verbal imediata de comandos
- Exige protocolo de controle de turno — quem pode falar agora?
- Latência percebida maior porque um lado precisa esperar o outro terminar
- Implementação de half-duplex exige lógica extra de controle

### O que é comunicação bidirecional (full-duplex)

O áudio flui **simultaneamente nas duas direções**, como uma ligação telefônica. Piloto e engenheiro podem falar e ouvir ao mesmo tempo, sem protocolo de turno, de forma completamente natural.

**Por que escolhemos full-duplex:**
- Comunicação natural sem nenhuma lógica extra de controle
- Engenheiro pode dar alertas imediatos mesmo enquanto o piloto fala
- O Q8 já implementa full-duplex nativamente no Mesh 3.0
- Os protocolos escolhidos (RTP + WebSocket) foram projetados para full-duplex
- Sem custo adicional de implementação em relação ao half-duplex

### Como o full-duplex funciona fisicamente

O Q8 possui microfone e speaker operando **ao mesmo tempo**. O sinal do microfone e o sinal do speaker percorrem **pinos fisicamente separados** no conector USB-C — são dois canais elétricos distintos dentro do mesmo cabo. O protocolo Mesh 3.0 também transmite os dois fluxos simultaneamente entre as duas unidades via rádio.

```
              ┌──────────────────────────────────────────────┐
              │          Mesh 3.0 (full-duplex, 2.4GHz)      │
  [Piloto]    │  voz piloto ──────────────────────────────►  │  [Base Painel]
  Q8 Capacete │  ◄──────────────────────── voz engenheiro    │  Q8 Base
              └──────────────────────────────────────────────┘
```

---

## 3. Protocolo de Comunicação — Mesh 3.0 EJEAS

### O que é o Mesh 3.0

O Mesh 3.0 é o protocolo de comunicação proprietário da EJEAS. Diferente do DMC da Cardo — também proprietário e completamente fechado — o Mesh 3.0 opera sobre a **camada física do Bluetooth 5.0**, mas com um protocolo de rede mesh próprio em cima.

O termo "mesh" significa que os dispositivos formam uma rede onde cada nó pode retransmitir o sinal de outro — se o piloto estiver longe da base, mas perto de outro Q8 (de outro piloto da equipe, por exemplo), o áudio é roteado automaticamente pelo nó intermediário. Para vocês com dois Q8, esse roteamento não é necessário, mas o protocolo usa a mesma base tecnológica.

### Características técnicas

| Parâmetro | Valor |
|---|---|
| Frequência | 2.4 GHz |
| Camada física | Bluetooth 5.0 |
| Protocolo de rede | Mesh 3.0 (proprietário EJEAS) |
| Alcance em campo aberto | 600–1000m |
| Participantes simultâneos | até 6 |
| Duplex | Full-duplex |
| Latência do link | ~20–30ms |
| Cancelamento de ruído | CVC (Clear Voice Capture) |
| Impermeabilização | IP67 |

### Por que Mesh 3.0 e não Bluetooth padrão

O Bluetooth tem vários **perfis** — conjuntos de regras para diferentes casos de uso. O perfil usado para chamadas é o **HFP (Hands-Free Profile)**. O HFP opera em **8 kHz mono**, que é qualidade de telefone fixo dos anos 90, com alcance limitado a ~10m e sensibilidade a interferências. O Mesh 3.0 opera com qualidade de voz significativamente superior e alcance de até 1km.

### Interferência com o Wi-Fi 5GHz das antenas Unifi

As antenas Unifi do sistema de telemetria operam em **5 GHz**. O Mesh 3.0 opera em **2.4 GHz**. São bandas de rádio completamente separadas no espectro eletromagnético — fisicamente impossível haver interferência entre elas. A escolha da Unifi em 5GHz foi deliberada justamente para deixar o 2.4GHz livre para o intercomunicador.

---

## 4. Hardware Escolhido e Justificativa

### Por que EJEAS Q8 e não Cardo Packtalk Neo

| Critério | Cardo Packtalk Neo | EJEAS Q8 |
|---|---|---|
| Preço (kit 2 unidades) | ~R$3.500 | ~R$1.750 |
| Alcance | 1.6km | 600m–1km |
| Cancelamento de ruído | Avançado (motor combustão 120km/h) | CVC (suficiente para elétrico) |
| Saída de áudio | P2 padrão | USB-C pinagem proprietária |
| Protocolo | DMC (fechado, sem solução DIY) | Mesh 3.0 (fechado, mas pinagem mapeável) |

O Cardo é projetado para motociclistas a 120km/h com motor a combustão ruidoso. Um Formula SAE elétrico opera em condições mais controladas, com velocidades menores e motor silencioso. O Q8 entrega tudo que o projeto precisa pela metade do preço. A complexidade extra do mapeamento USB-C é um problema de engenharia que a equipe resolve internamente — economizando R$1.750.

### Por que não DIY completo com ESP32

A opção de construir o sistema inteiro com módulos ESP32 custaria ~R$200–300, mas apresenta problemas estruturais para uso em capacete de corrida:

- Microfone genérico sem cancelamento de ruído ativo — captura ruído de vento e pista junto com a voz
- Fixação mecânica dentro do capacete é problema não trivial de engenharia mecânica
- Speaker precisa ficar posicionado precisamente próximo ao ouvido sem pressionar
- Resistência a vibração e temperatura não certificada
- O piloto usa em condições de emergência — não é contexto para protótipo

O kit do capacete (Q8 unidade 1) é o ponto mais crítico do sistema. Hardware profissional aqui não é luxo, é necessidade.

---

## 5. Arquitetura Física Completa

```
╔══════════════════════╗
║  CAPACETE DO PILOTO  ║
║  EJEAS Q8 (Unidade 1)║  ← kit de montagem fixado no capacete
║  microfone + speaker ║    alimentado pela bateria interna do Q8
╚══════════╤═══════════╝
           │
           │  Mesh 3.0 — 2.4GHz, full-duplex, ~20–30ms, até 1km
           │  (sem fio — piloto sem nenhum cabo)
           │
╔══════════╧═══════════╗
║  PAINEL DO CARRO     ║
║  EJEAS Q8 (Unidade 2)║  ← fixado no painel, alimentado pelo carro
║  "Base"              ║
╚══════════╤═══════════╝
           │
           │  Cabo USB-C (fornecido com o Q8)
           │
╔══════════╧═══════════════════════════════════════╗
║  Breakout USB-C Fêmea 24 pinos                   ║  ← fixada no painel
║                                                  ║
║  Alimentação:                                    ║
║    5V DC (carro) → pinos VBUS (A4/B4)            ║
║    GND (carro)   → pinos GND  (A1/B1)            ║
║    5.1kΩ em CC1 (A5) e CC2 (B5) → GND            ║
║                                                  ║
║  Áudio (pinos mapeados):                         ║
║    GND áudio → Sleeve do TRRS                    ║
║    L         → Tip    do TRRS                    ║
║    R         → Ring1  do TRRS                    ║
║    MIC       → Ring2  do TRRS                    ║
╚══════════╤═══════════════════════════════════════╝
           │
           │  Fios soldados (4 pinos: GND, L, R, MIC)
           │
╔══════════╧═══════════╗
║  Conector TRRS P2    ║
║  Fêmea 3.5mm 4 pinos ║  Tip=L | Ring1=R | Ring2=MIC | Sleeve=GND
╚══════════╤═══════════╝
           │
           │  Cabo P2 macho-macho longo
           │
╔══════════╧═══════════╗
║  Adaptador DAC       ║
║  USB-C → P2          ║  ← converte sinal analógico em USB Audio Class
║  (já disponível)     ║    Linux enxerga como dispositivo de áudio
╚══════════╤═══════════╝
           │
           │  USB-C
           │
╔══════════╧═══════════╗
║  Jetson AGX Xavier   ║
║  192.168.1.6         ║
║                      ║
║  ALSA captura PCM    ║
║  → cpal (Rust)       ║
║  → audiopus encode   ║
║  → UDP/RTP           ║
╚══════════╤═══════════╝
           │
           │  UDP/RTP — Wi-Fi 5GHz (Unifi)
           │  ~32kbps por direção
           │
╔══════════╧═══════════╗
║  Servidor            ║
║  192.168.1.100       ║
║  telemetry-server    ║
║                      ║
║  Recebe UDP/RTP Opus ║
║  → grava backup      ║
║  → WebSocket :8084   ║
╚══════════╤═══════════╝
           │
           │  WebSocket (Opus comprimido, sem decodar no servidor)
           │
╔══════════╧═══════════╗
║  Engenheiro / Pit    ║
║  App Android ou      ║
║  Navegador           ║
║                      ║
║  Web Audio API       ║
║  decodifica Opus     ║
║  → speaker           ║
╚══════════════════════╝
```

---

## 6. Alimentação do Q8 Base no Painel

### Fonte de alimentação

O carro já dispõe de linha DC 5V próxima ao painel, usada diretamente para alimentar o Q8 base — eliminando qualquer dependência de bateria interna que poderia acabar durante a corrida.

### Pinos USB-C de alimentação

O padrão USB-C define os seguintes pinos de alimentação:

| Pino(s) | Função |
|---|---|
| A4, A9, B4, B9 | VBUS — 5V positivo |
| A1, A12, B1, B12 | GND — terra |
| A5 (CC1), B5 (CC2) | Negociação de energia |

```
5V DC (carro) ──► pino A4 ou B4 (VBUS) na breakout
GND (carro)   ──► pino A1 ou B1 (GND)  na breakout
```

### Por que os resistores CC1/CC2 são obrigatórios

O protocolo USB-C usa os pinos CC1 e CC2 para **negociar tensão e corrente** entre fonte e dispositivo antes de ligar a alimentação. Sem esses pinos configurados, muitos dispositivos USB-C recusam a alimentação ou ficam em estado instável — é um mecanismo de proteção do padrão.

Para simular uma fonte USB-C padrão 5V/500mA, basta colocar um resistor de **5.1kΩ** de cada pino CC para GND. Isso sinaliza ao Q8 que a fonte é um carregador padrão de 5V:

```
A5 (CC1) ──┤ 5.1kΩ ├──► GND
B5 (CC2) ──┤ 5.1kΩ ├──► GND
```

Custo: ~R$1 (dois resistores).

### Separação de GND — prevenção de ground loop

O GND de alimentação (transporta corrente de retorno alta) e o GND de áudio (sinal analógico de milivolts) devem usar **fios fisicamente separados** dentro da breakout, mesmo que terminem no mesmo ponto de referência do carro.

O problema que isso previne é o **ground loop**: quando corrente elétrica de retorno da alimentação passa pelo mesmo fio do GND de áudio, ela induz uma tensão parasita no sinal — resultando em chiado ou hum de 60Hz audível no speaker.

```
Correto:
  GND alimentação → fio 22AWG (grosso) → pinos A1/B1 da breakout
  GND áudio       → fio 28AWG (fino)   → pino GND do conector TRRS
  (os dois chegam ao mesmo ponto de referência do carro, mas por caminhos físicos separados)
```

---

## 7. Mapeamento de Pinos USB-C

### Por que o mapeamento é necessário

A EJEAS utiliza **pinagem USB-C não-padrão** para o sinal de áudio. Qualquer adaptador genérico USB-C para P2 do mercado assume a pinagem da norma USB-C Audio Adapter Accessory Mode e não funciona com o Q8. A Comset (fabricante holandês) vende um adaptador específico (~€12), mas construir o nosso é mais barato e integra melhor com a arquitetura.

### Ferramentas necessárias

- Multímetro digital com modo continuidade e modo AC mV
- Breakout board USB-C fêmea 24 pinos
- Fone de ouvido TRRS barato como referência
- Q8 ligado e pareado para os testes de sinal ativo

### Etapa 1 — Identificar os contatos do fone TRRS de referência

O padrão CTIA/AHJ (usado em fones de celular modernos com microfone):

```
Tip    (ponta,  contato 1) → Canal Esquerdo (L)
Ring1  (anel 1, contato 2) → Canal Direito (R)
Ring2  (anel 2, contato 3) → Microfone (MIC)
Sleeve (base,   contato 4) → Terra (GND)
```

Com multímetro em continuidade, rastreie cada fio interno do fone e confirme qual contato externo corresponde a qual sinal.

### Etapa 2 — Localizar GND (Q8 desligado)

```
1. Conectar o cabo USB-C do Q8 na breakout
2. Multímetro em modo continuidade
3. Probe preto em qualquer GND conhecido do circuito
4. Probe vermelho varrendo cada pino da breakout
5. Quando beepar → esse é um pino GND do Q8
   (esperado: A1, A12, B1 ou B12)
```

### Etapa 3 — Localizar VBUS (Q8 ligado)

```
1. Ligar o Q8
2. Multímetro em modo DC V
3. Medir entre cada pino e o GND já identificado
4. Pino com ~5V → VBUS
   ⚠️ Identificar e isolar — nunca conectar VBUS a sinal de áudio
```

### Etapa 4 — Localizar L e R (Q8 ligado, reproduzindo tom de teste)

```
1. Parear um celular com o Q8
2. Reproduzir arquivo de teste de canal (app de teste de áudio estéreo):
   - Tom grave (100Hz) no canal esquerdo
   - Tom agudo (1kHz)  no canal direito
3. Multímetro em modo AC mV
4. Varrer os pinos candidatos: SBU1 (A8), SBU2 (B8), D+ (A6/B6), D- (A7/B7)
5. Pino com tensão AC oscilando → sinal de áudio
6. Identificar L vs R pela frequência (grave = L, agudo = R)
```

### Etapa 5 — Localizar MIC (Q8 ligado)

```
1. Falar próximo ao microfone do Q8 base
2. Multímetro em modo AC mV
3. Varrer os pinos restantes
4. Pino com tensão AC variando conforme a voz → MIC
```

### Tabela de mapeamento (preencher durante o teste)

| Sinal | Pino USB-C Q8 | Destino no TRRS |
|---|---|---|
| GND áudio | _______ | Sleeve |
| VBUS 5V | _______ | (alimentação — não vai ao TRRS) |
| Áudio L | _______ | Tip |
| Áudio R | _______ | Ring1 |
| MIC | _______ | Ring2 |
| CC1 | A5 | Resistor 5.1kΩ → GND |
| CC2 | B5 | Resistor 5.1kΩ → GND |

---

## 8. Montagem do Circuito

A breakout board é usada **permanentemente** no circuito — não é só para mapeamento. Ela fica fixada no painel do carro e serve como ponto de conexão central entre o Q8, a alimentação e o cabo de áudio para a Jetson.

### Diagrama de soldagem

```
Breakout USB-C 24 pinos (fixada no painel)
┌──────────────────────────────────────────────────────┐
│  A4/B4 (VBUS) ──────────────────────── 5V DC carro   │
│  A1/B1 (GND)  ──────────────────────── GND carro     │
│  A5 (CC1) ──┤5.1kΩ├──────────────────── GND          │
│  B5 (CC2) ──┤5.1kΩ├──────────────────── GND          │
│                                                      │
│  [GND mapeado]  ─── fio 28AWG ──── Sleeve ───────────┼──► TRRS P2 fêmea
│  [L mapeado]    ─── fio 28AWG ──── Tip    ───────────┼──►
│  [R mapeado]    ─── fio 28AWG ──── Ring1  ───────────┼──►
│  [MIC mapeado]  ─── fio 28AWG ──── Ring2  ───────────┼──►
└──────────────────────────────────────────────────────┘
         ↑
  cabo USB-C do Q8 entra aqui
```

### Boas práticas de soldagem para ambiente de corrida

- Fio **28AWG** para sinais de áudio (L, R, MIC, GND áudio) — sinal fraco, fio fino suficiente
- Fio **22AWG** para alimentação (VBUS, GND alimentação) — corrente maior, fio mais grosso
- **Tubo termo-retrátil** em cada solda individual — evita curto por vibração
- **Fixação da breakout** com parafusos M2 ou epóxi estrutural — vibração do carro não pode soltar
- **Caixa protetora** impressa em 3D ou cortada em PVC ao redor do circuito

---

## 9. Integração com a Jetson AGX Xavier

### Como o Linux enxerga o DAC USB-C

Quando o adaptador DAC USB-C é conectado na Jetson, o kernel Linux o reconhece automaticamente como um dispositivo **USB Audio Class (UAC)**. O UAC é um padrão universal — qualquer DAC USB compatível funciona sem instalar driver adicional. O kernel cria dois dispositivos virtuais:

```
/dev/snd/pcmC1D0c  → capture  (entrada — lê o microfone)
/dev/snd/pcmC1D0p  → playback (saída  — envia para o speaker)
```

Para verificar o reconhecimento:

```bash
lsusb               # deve listar o DAC como dispositivo USB
arecord -l          # lista dispositivos de captura disponíveis
aplay -l            # lista dispositivos de reprodução disponíveis
```

### Configuração do ALSA para baixa latência

O ALSA por padrão usa buffers de 40ms para captura de áudio. Para o sistema de comunicação de voz, configuramos buffers de **10ms** — reduzindo a contribuição do buffer para a latência total:

Criar ou editar `/etc/asound.conf` na Jetson:

```conf
defaults.pcm.!rate 48000
defaults.pcm.!period_size 480
defaults.pcm.!periods 4
```

`period_size 480` = 480 amostras. A 48kHz, cada amostra dura 1/48000 segundos. Portanto 480 amostras = 480/48000 = **10ms por chunk**.

### Testes de validação antes de integrar com Rust

```bash
# Gravar 5 segundos de áudio (falar no Q8 capacete durante o teste)
arecord -D hw:1,0 -f S16_LE -r 48000 -c 1 -d 5 teste_mic.wav

# Reproduzir (deve sair pelo Q8 capacete)
aplay -D hw:1,0 teste_mic.wav

# Teste loopback bidirecional ao vivo
arecord -D hw:1,0 -f S16_LE -r 48000 -c 1 | aplay -D hw:1,0
```

---

## 10. A Stack de Áudio — ALSA, cpal e Opus explicados

Esta seção explica em detalhe cada tecnologia da stack de áudio, o que ela é, por que existe e o que faz especificamente no projeto.

### ALSA — Advanced Linux Sound Architecture

ALSA é a **camada de áudio do kernel Linux**. Não é um protocolo de rede — é a interface entre o hardware de áudio físico e os programas que rodam no sistema operacional.

Analogia: o ALSA é para áudio o que o driver de placa de rede é para o Wi-Fi. Você não "usa o ALSA" diretamente — você usa programas que falam com o ALSA, que por sua vez fala com o hardware.

No projeto, quando o DAC USB-C é conectado na Jetson, o ALSA expõe dois canais:
- **Captura:** lê as amostras de áudio que chegam pelo cabo (voz do piloto via Q8 base)
- **Reprodução:** escreve amostras de áudio no cabo (voz do engenheiro para o Q8 base)

### cpal — Cross-Platform Audio Library (crate Rust)

`cpal` é uma biblioteca Rust que abstrai o acesso ao ALSA (no Linux) e equivalentes em outros sistemas operacionais. Em vez de fazer chamadas diretas ao ALSA com código C, o código Rust usa `cpal` para:

```rust
// Criar stream de captura (microfone)
let input_stream = device.build_input_stream(
    &config,
    move |data: &[f32], _| {
        // data contém amostras PCM brutas de 10ms
        sender.send(data.to_vec()).unwrap();
    },
    err_fn,
)?;
```

O `cpal` entrega blocos de amostras **PCM brutas** — números representando a amplitude do som em cada instante. A 48kHz com período de 10ms, cada bloco contém 480 amostras.

### O que é PCM (Pulse Code Modulation)

PCM é o formato de áudio mais primitivo e sem compressão. Cada amostra é um número que representa a pressão sonora naquele instante. A 48kHz, o sistema captura 48.000 amostras por segundo.

```
Áudio bruto PCM:
  48.000 amostras/segundo × 16 bits/amostra × 1 canal = 768.000 bits/segundo = 768 kbps
```

768 kbps de PCM bruto funcionaria na rede de vocês (que tem 100 Mbps), mas desperdiçaria banda e impossibilitaria backup eficiente. Por isso existe o Opus.

### Opus — o codec de voz

**Codec** = **co**dificador/**dec**odificador. O Opus é um algoritmo de compressão de áudio projetado especificamente para **voz em tempo real com baixa latência**, desenvolvido pela IETF (Internet Engineering Task Force) e adotado como padrão aberto.

O Opus analisa as amostras PCM e elimina informação redundante — frequências que o ouvido humano não percebe em contexto de fala, silêncios, padrões repetitivos. O resultado é um pacote muito menor representando o mesmo áudio percebido:

```
PCM bruto:    768 kbps  (768.000 bits por segundo)
Opus 16kbps:   16 kbps  (16.000 bits por segundo)
Redução:       98%
```

A crate `audiopus` em Rust é um wrapper para a biblioteca C oficial do Opus:

```rust
use audiopus::{Encoder, Application, SampleRate, Channels};

// Criar encoder configurado para voz
let encoder = Encoder::new(
    SampleRate::Hz48000,
    Channels::Mono,
    Application::Voip,    // modo otimizado para voz (vs música)
)?;

// Comprimir 480 amostras PCM em um pacote Opus
let mut output = vec![0u8; 1000];
let compressed_size = encoder.encode_float(&pcm_samples, &mut output)?;
// compressed_size é tipicamente 40 bytes para 10ms de voz @ 16kbps
```

### FEC — Forward Error Correction

O Opus tem **FEC (Forward Error Correction — Correção de Erros para Frente)** embutido. Isso significa que cada pacote Opus carrega não apenas o áudio atual, mas também uma **versão de baixa qualidade do pacote anterior**.

Se um pacote UDP for perdido na rede, o receptor usa a cópia de baixa qualidade embutida no pacote seguinte para reconstruir o perdido — em vez de ter um buraco de silêncio:

```
Sem FEC:
  pacote 1 ✅ → pacote 2 ❌ perdido → pacote 3 ✅
  resultado: [áudio] [SILÊNCIO 20ms] [áudio]

Com FEC:
  pacote 1 ✅ → pacote 2 ❌ perdido → pacote 3 ✅ (contém cópia do 2)
  resultado: [áudio] [áudio recuperado] [áudio]
```

O FEC adiciona ~3–4kbps ao bitrate mas elimina praticamente todos os glitches de perda de pacote.

### DTX — Discontinuous Transmission

Com DTX habilitado, o Opus **para de enviar pacotes quando não há voz** — detecta silêncio e manda apenas um pacote de conforto a cada 400ms, em vez de 50 pacotes por segundo. Reduz o bitrate médio para ~4kbps em momentos de silêncio.

---

## 11. Protocolo de Transporte — Por que UDP+RTP e não WebRTC

Esta é uma das decisões arquiteturais mais importantes do sistema. A explicação requer entender cada sigla envolvida.

### TCP vs UDP — a diferença fundamental

**TCP (Transmission Control Protocol)** garante entrega ordenada. Quando um pacote é perdido, o TCP para tudo e espera a retransmissão antes de entregar os próximos. Para arquivos e dados, isso é essencial. Para áudio em tempo real, é catastrófico:

```
TCP com perda de pacote (head-of-line blocking):
  pacote 1 ✅ entregue
  pacote 2 ❌ perdido → TCP solicita retransmissão
  pacote 3 ✅ recebido → RETIDO na fila, aguardando pacote 2
  pacote 4 ✅ recebido → RETIDO na fila, aguardando pacote 2
  ...~100ms depois...
  pacote 2 ✅ retransmitido → agora 3 e 4 são entregues juntos
  
  Resultado: silêncio de 100ms + burst de áudio = experiência péssima
```

**UDP (User Datagram Protocol)** não garante entrega. Pacotes perdidos são ignorados e o stream continua:

```
UDP com perda de pacote:
  pacote 1 ✅ entregue
  pacote 2 ❌ perdido → ignorado, segue em frente
  pacote 3 ✅ entregue imediatamente
  pacote 4 ✅ entregue imediatamente
  
  Resultado: glitch de 20ms quase imperceptível (com FEC: zero glitch)
```

**Na rede local de vocês (Wi-Fi Unifi 5GHz), perda de pacote é rara.** Na prática o TCP provavelmente funcionaria. Mas é uma fragilidade arquitetural que aparece justamente nos momentos de maior interferência de rádio — exatamente durante a corrida, com múltiplos rádios ativos na pista. UDP elimina esse risco estruturalmente.

### RTP — Real-time Transport Protocol

O UDP bruto não tem informações suficientes para áudio em tempo real. O **RTP (Real-time Transport Protocol)** roda em cima do UDP e adiciona um cabeçalho com metadados essenciais:

```
Pacote RTP sobre UDP:
┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Número de       │ Timestamp        │ Identificador    │ Payload          │
│ sequência       │ do áudio         │ do stream (SSRC) │ Opus comprimido  │
│ (2 bytes)       │ (4 bytes)        │ (4 bytes)        │ (~40 bytes)      │
└─────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

- **Número de sequência:** permite ao receptor saber se um pacote chegou fora de ordem ou foi perdido — sem isso, o UDP bruto não distingue ordem
- **Timestamp:** permite sincronizar o áudio corretamente no tempo, independente do jitter de rede
- **SSRC:** identifica qual stream de áudio é esse (útil quando há múltiplos streams)

O overhead do cabeçalho RTP é de apenas 12 bytes — insignificante.

### WebRTC — o que é e por que não usar

**WebRTC (Web Real-Time Communication)** é um **conjunto completo de protocolos** desenvolvido para resolver um problema específico: como dois navegadores na internet fazem uma chamada diretamente entre si, sem servidor no meio, passando por roteadores e firewalls que escondem os IPs reais.

O WebRTC inclui internamente:

```
WebRTC = ICE   (Interactive Connectivity Establishment)
       + STUN  (Session Traversal Utilities for NAT)
       + TURN  (Traversal Using Relays around NAT)
       + DTLS  (Datagram Transport Layer Security)
       + SDP   (Session Description Protocol)
       + SRTP  (Secure RTP)
       + SCTP  (Stream Control Transmission Protocol)
```

Explicando cada um:

- **ICE:** descobre como os dois lados podem se conectar, testando múltiplos caminhos de rede possíveis
- **STUN:** ajuda um dispositivo atrás de NAT a descobrir seu IP público
- **TURN:** relay de último recurso quando conexão direta é impossível
- **DTLS:** handshake criptográfico (~100–200ms de overhead no início da conexão)
- **SDP:** troca de mensagens de texto negociando codecs, IPs e portas antes de começar
- **SRTP:** RTP com criptografia (Secure RTP)
- **SCTP:** canal de dados paralelo ao canal de áudio

**O problema de vocês é fundamentalmente diferente do que o WebRTC resolve:**

```
Problema do WebRTC:
  Chrome no Brasil (IP desconhecido, atrás de NAT)
  ↕ precisa se encontrar e conectar
  Safari no Japão (IP desconhecido, atrás de NAT)
  → precisa de ICE, STUN, TURN, DTLS, SDP para isso funcionar

Problema de vocês:
  Jetson em 192.168.1.6
  ↕ mesma rede local, IP fixo, sem NAT, sem firewall
  Servidor em 192.168.1.100
  → basta abrir um socket UDP e enviar
```

Usar WebRTC na rede de vocês é o equivalente a contratar uma empresa de logística internacional com rastreamento em tempo real, seguro e intermediários aduaneiros para entregar uma carta para o vizinho do lado. Todo o mecanismo de descoberta e negociação vira overhead puro: código mais complexo, latência extra no handshake inicial, dependências pesadas em Rust, sem nenhum benefício real.

**O que vocês precisam é só do RTP** — a parte que realmente transporta o áudio. Sem ICE, sem DTLS, sem SDP.

### Por que usar WebSocket para o trecho servidor → engenheiro

O engenheiro acessa o sistema pelo **navegador** (App Android ou browser no notebook). Navegadores não têm acesso direto a sockets UDP por motivos de segurança — só conseguem abrir conexões HTTP, WebSocket e WebRTC.

O **WebSocket** é um protocolo que começa como uma requisição HTTP e faz upgrade para uma conexão bidirecional persistente. É suportado nativamente por todos os browsers e pelo Rust (crate `tokio-tungstenite`). O servidor recebe o Opus via UDP/RTP da Jetson e repassa via WebSocket para o browser do engenheiro — sem decodar no meio.

```
Jetson → UDP/RTP → Servidor → WebSocket → Browser engenheiro
         (Opus)               (Opus, sem reencoding)
```

---

## 12. Largura de Banda e Uso de Rede

### Capacidade da rede

A rede Wi-Fi Unifi 5GHz opera em **full-duplex lógico** — 100 Mbps de upload e 100 Mbps de download simultaneamente para fins de planejamento (na prática, 150–400 Mbps dependendo de distância e condições de RF).

### Cálculo do consumo de banda do áudio

```
Codec:          Opus 16kbps, frame 20ms, mono, 48kHz
Payload/pacote: 16kbps × 0.020s = 40 bytes
Pacotes/segundo: 1000ms / 20ms = 50 pacotes/s
Overhead RTP:   12 bytes/pacote
Overhead UDP:    8 bytes/pacote
Overhead IP:    20 bytes/pacote
Total overhead: 40 bytes/pacote × 50 = 2.000 bytes/s = 16 kbps

Total por direção: 16 kbps (payload) + 16 kbps (overhead) = ~32 kbps
Full-duplex (2 direções simultâneas):                       ~64 kbps
```

### Coexistência com telemetria CAN

| Fluxo | Banda | % da rede (100 Mbps) |
|---|---|---|
| Telemetria CAN (dados) | ~100 kbps | 0.10% |
| Áudio WebRTC piloto→pit | ~32 kbps | 0.03% |
| Áudio WebRTC pit→piloto | ~32 kbps | 0.03% |
| **Total sistema completo** | **~164 kbps** | **0.16%** |

O sistema inteiro — telemetria + áudio bidirecional — usa menos de **0,2% da capacidade da rede**. Não há competição por banda entre os sistemas.

---

## 13. Latência — Análise por Trecho

### Tabela de latência ponta a ponta (piloto → engenheiro)

| Trecho | Tecnologia | Latência |
|---|---|---|
| Mic capacete → processamento Q8 | Hardware interno | ~2 ms |
| Q8 capacete → Q8 base | Mesh 3.0 (2.4GHz, sem fio) | ~20–30 ms |
| Q8 base → breakout → DAC | Cabo físico + USB | ~1 ms |
| Buffer ALSA configurado (10ms) | Kernel Linux | ~10 ms |
| cpal leitura + audiopus encode | Rust, CPU Jetson | ~5 ms |
| Frame Opus (20ms) | Codec | ~10 ms |
| UDP/RTP Jetson → Servidor | Wi-Fi 5GHz Unifi | ~2–5 ms |
| Servidor → Browser engenheiro | WebSocket LAN | ~1–2 ms |
| Browser decodifica Opus | Web Audio API | ~3 ms |
| **Total piloto → engenheiro** | | **~54–68 ms** |

### Contexto — por que esse número é excelente

| Sistema | Latência típica |
|---|---|
| Telefonia VoIP (padrão ITU-T) | < 150 ms |
| WhatsApp / Telegram voz | 80–200 ms |
| Rádio amador (repeater) | 200–500 ms |
| **Sistema de vocês** | **54–68 ms** |
| Limiar de percepção humana | ~150 ms |

O ouvido humano começa a perceber delay em conversas a partir de ~150ms. O sistema de vocês opera com **menos da metade** desse limiar — a comunicação será completamente natural.

### Onde está o gargalo dominante

O trecho **Mesh 3.0 entre os dois Q8** (~20–30ms) é o gargalo dominante. Esse valor é fixo e determinado pelo hardware — não há como otimizar. A otimização de software mais impactante é a configuração do buffer ALSA para 10ms (em vez dos 40ms padrão), que já está documentada na Seção 9.

---

## 14. Backup de Áudio

### Por que TCP é correto para backup (ao contrário do streaming ao vivo)

O TCP é problemático para streaming de voz ao vivo porque o head-of-line blocking causa pausas perceptíveis. Mas para backup, o TCP é **exatamente o protocolo certo** — você precisa de entrega garantida e ordenada. Todo arquivo que você baixa da internet usa TCP.

O backup não é streaming — é gravação. Não tem problema nenhum que um chunk demore 100ms a mais para chegar ao disco. O que importa é que **chegue completo e na ordem correta**.

### Estratégia de backup duplo

```
Jetson (primária):
  audiopus encode → Opus
    ├── grava em ~/audio_backup/YYYYMMDD_HHMMSS.opus  (local)
    └── envia via UDP/RTP → Servidor (ao vivo)

Servidor (secundária):
  recebe UDP/RTP Opus
    ├── grava em ~/audio_backup/YYYYMMDD_HHMMSS.opus  (remota)
    └── repassa via WebSocket → Engenheiro (ao vivo)
```

### Por que gravar Opus e não PCM

| Formato | Tamanho por minuto | Por 30 min de corrida |
|---|---|---|
| PCM bruto 48kHz/16bit | 5.5 MB | 165 MB |
| Opus 16kbps | 0.12 MB | 3.6 MB |

Para uma temporada completa com múltiplas corridas e treinos, a diferença entre PCM e Opus pode ser de gigabytes. O Opus mantém qualidade de voz excelente a 16kbps — não há motivo para guardar PCM bruto.

### Fallback — Wi-Fi cai durante a corrida

Se o Wi-Fi cair, a Jetson continua gravando localmente sem interrupção. O UDP não tentará retransmitir — simplesmente perde os pacotes ao vivo. O backup local permanece íntegro. Após a corrida, o arquivo local pode ser copiado manualmente para o servidor via SSH:

```bash
scp eracing@192.168.1.6:~/audio_backup/*.opus ~/audio_backup/
```

---

## 15. Fluxo Completo de Dados — ponta a ponta

### Direção 1: Piloto → Engenheiro

```
[Piloto fala no capacete]
        ↓
[Q8 Unidade 1 — Capacete]
  microfone captura voz
  CVC cancela ruído de fundo
        ↓ Mesh 3.0 (2.4GHz, ~25ms)
[Q8 Unidade 2 — Base no Painel]
  recebe áudio do capacete
        ↓ pinos USB-C mapeados → breakout → TRRS → cabo P2
[Adaptador DAC USB-C]
  converte sinal analógico → USB Audio Class
        ↓ USB-C
[Jetson AGX Xavier — ALSA]
  kernel lê amostras do DAC
        ↓ cpal (Rust) lê PCM bruto em chunks de 10ms (480 amostras)
        ↓ audiopus encode → pacote Opus ~40 bytes + FEC
        ├── grava pacote em ~/audio_backup/sessao.opus
        └── monta pacote RTP (seq + timestamp + SSRC + payload Opus)
            ↓ UDP socket → 192.168.1.100:8083
[Servidor — telemetry-audio (Rust)]
  recebe pacote UDP/RTP
        ├── grava em ~/audio_backup/sessao.opus
        └── extrai payload Opus
            ↓ WebSocket broadcast → clientes conectados na porta 8084
[Browser Engenheiro / App Android]
  recebe payload Opus via WebSocket
        ↓ Web Audio API decodifica Opus nativamente
        ↓ speaker do engenheiro
[Engenheiro ouve o piloto]
```

### Direção 2: Engenheiro → Piloto (simultânea)

```
[Engenheiro fala no microfone do notebook/celular]
        ↓
[Browser / App Android]
  Web Audio API captura PCM
        ↓ encode Opus (MediaRecorder API ou AudioWorklet)
        ↓ WebSocket → Servidor porta 8084
[Servidor — telemetry-audio (Rust)]
  recebe Opus via WebSocket
        ├── grava em ~/audio_backup/sessao_pit.opus
        └── monta pacote RTP
            ↓ UDP socket → 192.168.1.6:8083
[Jetson AGX Xavier]
  recebe pacote UDP/RTP
        ↓ extrai payload Opus
        ↓ audiopus decode → PCM bruto
        ↓ cpal escreve PCM no DAC (ALSA playback)
        ↓ cabo P2 → adaptador DAC → breakout → pinos USB-C → Q8 base
[Q8 Unidade 2 — Base no Painel]
  reproduz áudio no speaker interno
        ↓ Mesh 3.0 (2.4GHz, ~25ms)
[Q8 Unidade 1 — Capacete]
  speaker reproduz voz do engenheiro
[Piloto ouve o engenheiro]
```

---

## 16. Integração com o telemetry-server (Rust)

### Por que crate separado e não embutir no telemetry-server

O `telemetry-server` já tem responsabilidades bem definidas: receber dados CAN via TCP, persistir em TimescaleDB e SQLite, e distribuir via WebSocket. Embutir áudio ali misturaria responsabilidades diferentes e dificultaria manutenção.

A solução é um **crate separado** no mesmo workspace:

```
TelemetriaV2/
├── telemetry-edge/        ← CAN bus → TCP (roda na Jetson)
├── telemetry-server/      ← TCP → DB → WebSocket (roda no servidor)
├── telemetry-audio-edge/  ← ALSA → Opus → UDP/RTP (roda na Jetson)
└── telemetry-audio-srv/   ← UDP/RTP → WebSocket + backup (roda no servidor)
```

### Cargo.toml do telemetry-audio-edge (Jetson)

```toml
[package]
name = "telemetry-audio-edge"
version = "2.0.0"
edition = "2021"
description = "Captura ALSA → encode Opus → UDP/RTP → Servidor"

[dependencies]
cpal        = "0.15"
audiopus    = "0.3"
tokio       = { version = "1", features = ["full"] }
tracing     = "0.1"
tracing-subscriber = "0.3"
```

### Cargo.toml do telemetry-audio-srv (Servidor)

```toml
[package]
name = "telemetry-audio-srv"
version = "2.0.0"
edition = "2021"
description = "UDP/RTP → backup + WebSocket distribuição"

[dependencies]
tokio            = { version = "1", features = ["full"] }
tokio-tungstenite = "0.21"
tracing          = "0.1"
tracing-subscriber = "0.3"
```

> **Nota:** o servidor **não usa audiopus** — ele repassa o Opus comprimido diretamente para os clientes sem decodar. Isso economiza CPU e elimina uma etapa de processamento.

### Estrutura dos módulos

```
telemetry-audio-edge/src/
├── main.rs          ← inicializa, conecta UDP, gerencia tarefas tokio
├── capture.rs       ← lê ALSA via cpal, produz chunks PCM de 10ms
├── playback.rs      ← escreve PCM no ALSA via cpal (direção engenheiro→piloto)
├── codec.rs         ← encode/decode Opus via audiopus
├── rtp.rs           ← monta e parseia cabeçalho RTP
└── backup.rs        ← grava arquivo .opus local com timestamp

telemetry-audio-srv/src/
├── main.rs          ← inicializa UDP listener + WebSocket server
├── relay.rs         ← recebe RTP UDP, extrai Opus, broadcast WebSocket
└── backup.rs        ← grava arquivo .opus no servidor com timestamp
```

### Framing RTP — implementação simplificada

Para a rede local de vocês, uma implementação mínima do cabeçalho RTP é suficiente:

```rust
// rtp.rs
pub struct RtpPacket {
    pub sequence: u16,
    pub timestamp: u32,
    pub payload: Vec<u8>,  // Opus comprimido
}

impl RtpPacket {
    pub fn serialize(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(12 + self.payload.len());
        // Byte 0-1: versão (2) + padding (0) + extension (0) + CC (0) + marker (0) + PT (111 = Opus)
        buf.extend_from_slice(&[0x80, 0x6F]);
        buf.extend_from_slice(&self.sequence.to_be_bytes());
        buf.extend_from_slice(&self.timestamp.to_be_bytes());
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]); // SSRC fixo
        buf.extend_from_slice(&self.payload);
        buf
    }

    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < 12 { return None; }
        Some(Self {
            sequence: u16::from_be_bytes([data[2], data[3]]),
            timestamp: u32::from_be_bytes([data[4], data[5], data[6], data[7]]),
            payload: data[12..].to_vec(),
        })
    }
}
```

---

## 17. Lista de Materiais

| # | Componente | Especificação | Qtd | Preço |
|---|---|---|---|---|
| 1 | EJEAS Q8 Kit | 2 unidades, Mesh 3.0, IP67 | 1 kit | ~R$1.750 |
| 2 | Breakout USB-C fêmea | 24 pinos completos, headers identificados | 1 | ~R$15 |
| 3 | Conector TRRS P2 fêmea | 3.5mm, 4 pinos CTIA/AHJ, through-hole | 1 | ~R$5 |
| 4 | Resistor 5.1kΩ | Para CC1 e CC2 da negociação USB-C | 2 | ~R$1 |
| 5 | Cabo P2 macho-macho | 3.5mm TRRS, 1–2m | 1 | ~R$20 |
| 6 | Fio 28AWG | Sinais de áudio (cores distintas) | ~0.5m | ~R$3 |
| 7 | Fio 22AWG | Alimentação VBUS/GND | ~0.3m | ~R$2 |
| 8 | Tubo termo-retrátil | Isolamento das soldas | 1 kit | ~R$5 |
| 9 | Adaptador USB-C DAC | USB-C → P2 (já disponível na equipe) | 1 | — |
| | **TOTAL** | | | **~R$1.801** |

---

## 18. Checklist de Implementação

### Fase 1 — Compra e recebimento

- [ ] Comprar EJEAS Q8 Kit 2 unidades
- [ ] Comprar Breakout USB-C fêmea 24 pinos
- [ ] Comprar conector TRRS P2 fêmea 4 pinos
- [ ] Separar 2x resistor 5.1kΩ do estoque da equipe
- [ ] Comprar cabo P2 macho-macho 1–2m

### Fase 2 — Mapeamento de pinos

- [ ] Parear os dois Q8 entre si (seguir manual EJEAS)
- [ ] Conectar Q8 base no notebook Linux com cabo USB-C
- [ ] Rodar `lsusb` e `aplay -l` — verificar se aparece como UAC
  - [ ] **Se aparecer (Cenário B — UAC):** cabo USB-C direto na Jetson, pular para Fase 4
  - [ ] **Se não aparecer (Cenário A — analógico):** continuar Fase 3
- [ ] Identificar GND com multímetro em continuidade (Q8 desligado)
- [ ] Identificar VBUS com multímetro em DC V (Q8 ligado)
- [ ] Identificar L e R com tom de teste e multímetro AC mV
- [ ] Identificar MIC falando no microfone
- [ ] Preencher tabela de mapeamento da Seção 7

### Fase 3 — Montagem do circuito (Cenário A)

- [ ] Soldar resistores CC1/CC2 (5.1kΩ) na breakout
- [ ] Soldar fios de alimentação (VBUS, GND) em 22AWG
- [ ] Soldar fios de áudio (L, R, MIC, GND áudio) em 28AWG
- [ ] Soldar conector TRRS P2 fêmea nas pontas dos fios de áudio
- [ ] Cobrir todas as soldas com tubo termo-retrátil
- [ ] Fixar breakout no painel do carro (parafusos M2 ou epóxi)
- [ ] Montar caixa protetora ao redor do circuito

### Fase 4 — Testes de áudio na Jetson

- [ ] Conectar cabo P2 → adaptador DAC → Jetson
- [ ] Verificar reconhecimento: `arecord -l` e `aplay -l`
- [ ] Configurar `/etc/asound.conf` com buffer 10ms
- [ ] Testar captura: `arecord` com piloto falando
- [ ] Testar reprodução: `aplay` com som saindo pelo Q8 capacete
- [ ] Testar loopback bidirecional simultâneo

### Fase 5 — Implementação Rust

- [ ] Criar crates `telemetry-audio-edge` e `telemetry-audio-srv` no workspace
- [ ] Implementar `capture.rs` com `cpal`
- [ ] Implementar `codec.rs` com `audiopus` (encode + decode)
- [ ] Implementar `rtp.rs` com framing RTP mínimo
- [ ] Implementar `backup.rs` com gravação de arquivo `.opus`
- [ ] Implementar `relay.rs` no servidor (UDP → WebSocket)
- [ ] Testar end-to-end: voz piloto → Jetson → Servidor → App Android

### Fase 6 — Validação final

- [ ] Medir latência real ponta a ponta com timestamp
- [ ] Validar bidirecionalidade simultânea (falar e ouvir ao mesmo tempo)
- [ ] Testar backup: desligar Wi-Fi, falar, religar, verificar arquivo local
- [ ] Testar alcance Mesh 3.0 na pista (carro em movimento)
- [ ] Validar que o sistema de áudio não afeta a latência da telemetria CAN

---

*Documento parte da série Telemetria V2 — E-Racing UNICAMP*
*Versão 2.0 — inclui arquitetura UDP/RTP corrigida, explicação completa de todas as tecnologias, raciocínio de decisões e análise de backup*
*Próximo: V2.2 — TLS/AES na camada de telemetria de dados*
