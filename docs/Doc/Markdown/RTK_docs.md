# RTK com SBG Ellipse 2 — Unicamp E-Racing
**Equipe:** Unicamp E-Racing  
**Sensor INS:** SBG Systems Ellipse 2  
**Base RTK:** NovAtel SMART-V1-2US-RT20  
**Hub:** Servidor Base Ubuntu (`143.106.207.21`)  
**Edge:** NVIDIA Jetson AGX Xavier (`143.106.207.93`)  
**Objetivo:** Reduzir a incerteza de posição do INS de 1–3 metros para ~20 cm via RTK offline, sem dependência de internet

---

## 1. Contexto e decisão

### Situação atual
O SBG Ellipse 2 operando sem correções diferenciais entrega precisão GNSS de **1 a 3 metros**. Para navegação autônoma e análise de trajetória em competição, esse erro é proibitivo.

### Por que RTK sem internet
Os eventos da Formula SAE não garantem conectividade externa no box. A solução adotada é uma **base RTK local própria**, eliminando qualquer dependência de rede externa. A NovAtel SMART-V1-2US-RT20, que estava ociosa na equipe, assume esse papel.

### Por que o RT-20 (20 cm) é suficiente
O modelo `RT20` no nome da NovAtel indica o algoritmo **RT-20® da NovAtel** — RTK single-frequency (L1 apenas), com precisão nominal de **~20 cm**. Isso representa uma melhora de **10–15x** em relação à situação atual, suficiente para análise de trajetória, calibração inercial e dados de posição para o sistema autônomo.

> **Upgrade futuro:** precisão centimétrica real (1–2 cm) exigiria receptor L1/L2 dual-frequency como u-blox F9P (~R$800). Toda a infraestrutura de software permanece igual — apenas troca o hardware de base.

---

## 2. Decodificação do modelo NovAtel

| Segmento | Significado |
|---|---|
| `SMART-V1` | Enclosure com chip OEMV-1 — receptor L1 GPS single-frequency |
| `2US` | 2 portas seriais RS-232, conector padrão US (DB-9) |
| `RT20` | Algoritmo RT-20® habilitado — RTK rover **e base**, precisão ~20 cm |

**Dados físicos confirmados pela etiqueta (serial NBL11050004, OSN 124729, HW 2.03):**

| Campo | Valor |
|---|---|
| Alimentação | **9–28 VDC** |
| Consumo | 350 mA |
| Interfaces | RS-232 + USB |
| Conector de I/O | Switchcraft EN3 circular, **18 pinos**, macho no corpo do receptor |

A NovAtel SMART-V1-2US-RT20 opera nesse sistema exclusivamente como **base estacionária no box**, transmitindo correções RTCM pela porta COM1.

---

## 3. Arquitetura do sistema

```
╔══════════════════════════════════════════════════════════╗
║                        BOX                              ║
║                                                          ║
║  [NovAtel SMART-V1-2US-RT20]                            ║
║   antena com visada livre do céu                        ║
║   survey-in 15–30 min antes da prova                    ║
║   gera RTCM via COM1 @ 115200 baud                      ║
║         │                                                ║
║    cabo Switchcraft 18p → DB-9 → USB-Serial             ║
║         │                                                ║
║  [Servidor Base — 143.106.207.21]                       ║
║   str2str recebe /dev/ttyUSB_novatel                    ║
║   retransmite como TCP server :2101                     ║
║   latência serial: ~1 ms                                ║
║         │                                                ║
╚═════════╪════════════════════════════════════════════════╝
          │
     rede local (roteador dedicado da equipe)
     TCP — porta 2101
     latência: < 5 ms
     latência total pipeline: 5–15 ms
     limite aceitável Ellipse: 4000 ms  ✓
          │
╔═════════╪════════════════════════════════════════════════╗
║         │              CARRO                             ║
║  [Jetson AGX Xavier — 143.106.207.93]                   ║
║   str2str conecta TCP 143.106.207.21:2101               ║
║   escreve RTCM em /dev/ttyUSB_ellipse_rtcm              ║
║   latência serial saída: ~1 ms                          ║
║         │                          │                     ║
║    RTCM serial                sbgECom serial             ║
║    Port A (in)                Port B (out)               ║
║         │                          │                     ║
║        [SBG Ellipse 2]             │                     ║
║         aplica RT-20               │                     ║
║         solução ~20 cm             │                     ║
║                                    ▼                     ║
║                          telemetry-edge (Rust)           ║
║                          parser sbgECom binário          ║
║                          ins_reader_task tokio           ║
║                          InsEvent → pipeline CAN         ║
╚══════════════════════════════════════════════════════════╝
```

### Latência do pipeline RTCM

| Trecho | Protocolo | Latência estimada |
|---|---|---|
| NovAtel → servidor (serial) | RS-232 115200 baud | ~1 ms |
| Servidor → Jetson (rede local) | TCP local | < 5 ms |
| Jetson → Ellipse (serial) | RS-232 115200 baud | ~1 ms |
| **Total** | | **5–15 ms** |
| Limite máximo aceito pelo Ellipse | | **4000 ms** |

O pipeline opera com margem de **200–800x** abaixo do limite crítico.

---

## 4. Integração física — explicação detalhada

### 4.1 Visão geral do fluxo físico

```
[Céu]
  │  sinal GPS L1
  ▼
[Antena NovAtel — patch interna ao SMART-V1]
  │
[Corpo NovAtel SMART-V1]
  │
  └── Conector Switchcraft 18 pinos (macho no receptor)
        │
        └── Cabo montado (ver Seção 4.3)
              ├── DB-9 macho (COM1) ──→ adaptador USB-Serial ──→ /dev/ttyUSB_novatel
              ├── DB-9 macho (COM2) ──→ livre
              ├── Fio vermelho (PWR) ──→ fusível 5A ──→ 12V DC
              └── Fio preto (GND) ──→ GND

                         │ /dev/ttyUSB_novatel
                         ▼
              [Servidor Base — Ubuntu]
              str2str lendo serial @ 115200
              TCP server :2101
                         │
              ───────────┤ rede local (roteador dedicado)
                         │
                         ▼
              [Jetson AGX Xavier]
              str2str cliente TCP
              escreve em /dev/ttyUSB_ellipse_rtcm @ 115200
                         │
              ───────────┤ cabo DB-9 → USB-Serial
                         ▼
              [SBG Ellipse 2 — Port A]  ←── RTCM in
              [SBG Ellipse 2 — Port B]  ──→ sbgECom → /dev/ttyUSB_ellipse_ecom
```

### 4.2 Hardware necessário

| Item | Status | Detalhe |
|---|---|---|
| NovAtel SMART-V1-2US-RT20 | ✅ disponível | serial NBL11050004 |
| **Cabo Switchcraft 18p → DB-9 + PWR** | ⚠️ **fabricar** (ver Seção 4.3) | NovAtel PN 01017893 — descontinuado, mercado secundário improvável no BR |
| Adaptador USB-Serial (DB-9 fêmea → USB-A) | ⚠️ verificar chip | para COM1 NovAtel → servidor base |
| Adaptador USB-Serial (DB-9 fêmea → USB-A) | ⚠️ verificar chip | para Port A Ellipse → Jetson (RTCM in) |
| Adaptador USB-Serial (DB-9 fêmea → USB-A) | ⚠️ verificar chip | para Port B Ellipse → Jetson (sbgECom out) |
| Roteador WiFi dedicado | ✅ disponível | link box ↔ carro |
| Fonte 12V DC para NovAtel | ✅ disponível | 9–28 VDC, fusível 5A obrigatório |
| Tripé ou suporte para NovAtel | ⚠️ providenciar | visada livre do céu no box |

> **Atenção aos adaptadores USB-Serial:** prefira chip FTDI FT232 sobre CH340 — mais estável em campo com reconexão frequente. Verifique os adaptadores já disponíveis na equipe com `lsusb` antes de misturar chips diferentes, pois a ordem de detecção pelo kernel pode variar.

---

## 4.3 Cabo NovAtel — Switchcraft 18 pinos → DB-9 + Alimentação

### 4.3.1 Contexto

O corpo do receptor NovAtel SMART-V1 tem um conector circular **Switchcraft EN3, 18 pinos, macho**. O cabo oficial NovAtel (PN **01017893**, "18-Pin Switchcraft to USB Multi-Cable") está **descontinuado e indisponível no mercado brasileiro**. A solução é fabricar o cabo manualmente.

O cabo oficial entrega:
- J2 — DB-9 socket (COM1)
- J3 — DB-9 socket (COM2)
- J4 — USB-A (USB do receptor)
- Fios soltos: PWR, PWR2, GND, GND2, PPS, Digital GND, Reserved

Para o plano RTK, **apenas COM1 e alimentação são obrigatórios**. O cabo mínimo funcional tem 5 condutores.

---

### 4.3.2 Pinagem completa — Tabela 32 do manual OEMV (om-20000093)

Fonte primária: manual oficial NovAtel, seção A.9.2.1, página 168.

| Pino J1 (Switchcraft, receptor) | Sinal | Destino no cabo |
|---|---|---|
| 1 | PWR | Fio vermelho → fusível 5A → 12V |
| 2 | GND | Fio preto → GND |
| 3 | TX2 | DB-9 J3 pino 2 (COM2 TX) |
| 4 | RX2 | DB-9 J3 pino 3 (COM2 RX) |
| **5** | **TX1** | **DB-9 J2 pino 2 (COM1 TX — RTCM sai aqui)** |
| **6** | **RX1** | **DB-9 J2 pino 3 (COM1 RX)** |
| 7 | NC | não conectar |
| 8 | NC | não conectar |
| 9 | Reserved | não conectar |
| 10 | USB D(-) | USB-A pino 2 (opcional) |
| **11** | **Digital GND** | **DB-9 J2 pino 5 (GND do serial)** |
| 12 | PPS | Fio azul (opcional — não usado no plano) |
| 13 | TX3 | NC (não existe no SMART-V1-2US) |
| 14 | RX3 | NC (não existe no SMART-V1-2US) |
| 15 | NC | não conectar |
| 16 | USB D(+) | USB-A pino 3 (opcional) |
| 17 | PWR2 | Fio laranja (redundância de alimentação — opcional) |
| 18 | GND2 | Fio marrom (redundância de GND — opcional) |

**Cores dos fios conforme Tabela 35 do manual:**

| Cor | Função |
|---|---|
| Vermelho | PWR |
| Laranja | PWR2 |
| Azul | PPS |
| Amarelo | Reserved |
| Verde | Digital GND |
| Marrom | GND2 |
| Preto | GND |

---

### 4.3.3 Opção A — Comprar o cabo pronto (mercado secundário)

**Part number oficial:** NovAtel **01017893** ("18-Pin Switchchraft to USB Multi-Cable")

**Onde buscar:**
- eBay: buscar `01017893 NovAtel` ou `NovAtel SMART-V1 cable`
- Revendedores de GPS survey usados (Axiom, Benchmark, GPS Used Equipment)
- Fóruns de GPS agricultura de precisão — a linha SMART-V1 foi muito usada no agro e cabos aparecem em lotes de descarte

**Custo estimado:** USD 30–80 (quando disponível)

**Vantagem:** plug-and-play, sem trabalho de montagem, testado de fábrica.

**Desvantagem:** disponibilidade imprevisível, envio internacional, prazo incompatível com urgência de competição.

> **Recomendação:** tentar localizar em paralelo com a fabricação. Se aparecer antes da prova, usar o oficial. O cabo fabricado fica como backup permanente.

---

### 4.3.4 Opção B — Fabricar o cabo (recomendada)

#### Materiais necessários

| Item | Especificação | Onde comprar |
|---|---|---|
| Conector Switchcraft EN3 fêmea 18 pinos | **Switchcraft EN3C18F** | Mouser, Digi-Key, Arrow — buscar `EN3C18F` |
| Pinos de crimping compatíveis EN3 | Verificar datasheet do EN3C18F — listados como "mating contacts" | Junto com o conector |
| Cabo multipolar | Mínimo 5 condutores, 24–26 AWG sinais, 20–22 AWG PWR/GND, comprimento 3–5 m | Mercado local ou Aliexpress |
| Conector DB-9 macho | Para COM1 (e COM2 se quiser) | Qualquer loja de eletrônica |
| Capa plástica DB-9 | Proteção mecânica | Junto com o DB-9 |
| Fusível 5A + porta-fusível inline | Para o fio de alimentação | Mercado local |
| Tubo termo-retrátil | Isolamento dos terminais | Mercado local |
| Alicate de crimping | Para pinos do EN3 — verificar bitola compatível | Ferramental da equipe |
| Multímetro | Teste de continuidade pós-montagem | Ferramental da equipe |

> **Antes de comprar o EN3C18F:** confirmar na datasheet do Switchcraft EN3 que o travamento é por rosca (não bayonet) — a foto do receptor mostra porca sextavada, consistente com rosca. O EN3C18F é o part number padrão da série fêmea 18 pinos com rosca. Verificar na página do produto da Mouser/Digi-Key antes de finalizar o pedido.

#### Cabo mínimo funcional (só COM1 + alimentação — 5 fios)

Para o plano RTK básico, apenas esses 5 condutores são necessários:

| Condutor | Cor sugerida | Pino J1 | Destino |
|---|---|---|---|
| PWR | Vermelho | 1 | Fusível 5A → terminal 12V |
| GND | Preto | 2 | Terminal GND |
| TX1 | Amarelo | 5 | DB-9 pino 2 |
| RX1 | Branco | 6 | DB-9 pino 3 |
| Digital GND | Verde | 11 | DB-9 pino 5 |

#### Cabo completo (COM1 + COM2 + alimentação — recomendado)

Adicionar 3 condutores extras para COM2 (útil para diagnóstico e configuração):

| Condutor | Cor sugerida | Pino J1 | Destino |
|---|---|---|---|
| TX2 | Laranja | 3 | DB-9 J3 pino 2 |
| RX2 | Azul | 4 | DB-9 J3 pino 3 |
| Digital GND (J3) | Verde (compartilhado) | 11 | DB-9 J3 pino 5 |

---

#### Passo a passo de montagem

**Passo 1 — Preparar o conector EN3C18F**

Abrir o conector separando o anel traseiro de travamento (rosca ou pressão, depende do modelo). Separar os 18 pinos de crimping. Identificar a numeração dos pinos no corpo plástico — o Switchcraft EN3 tem os números marcados internamente. Conferir com o diagrama da Tabela 32 antes de crimpear.

**Passo 2 — Preparar os fios**

Cortar os condutores no comprimento necessário (estimar o percurso real no box — sugere-se 4 m de folga). Decapar 2–3 mm na extremidade que vai para o pino de crimping. Usar tubo termo-retrátil fino em cada fio antes de crimpear (mais fácil que depois).

**Passo 3 — Crimpar os pinos**

Crimpar cada pino no fio correspondente com o alicate. O pino do EN3 tem dois rebites: um para o fio e um para a isolação. Garantir que o rebite do fio agarra o cobre exposto, não a isolação. Puxar levemente o fio após crimpear — não deve soltar.

**Passo 4 — Inserir pinos no corpo do conector**

Inserir cada pino na cavidade numerada correta. O EN3 tem trava por clipe interno — empurrar até sentir o clique de encaixe. Depois do clique, puxar levemente para confirmar que travou. Pino que sai facilmente não travou — reinserir.

**Passo 5 — Fechar o conector**

Reapertar o anel traseiro. Puxar o cabo para garantir que a trava traseira está segurando.

**Passo 6 — Montar o DB-9 (COM1)**

Soldar ou crimpear os fios nos pinos do DB-9 macho:

```
Fio amarelo (TX1 do receptor, pino J1-5)  →  DB-9 pino 2
Fio branco  (RX1 do receptor, pino J1-6)  →  DB-9 pino 3
Fio verde   (Digital GND, pino J1-11)     →  DB-9 pino 5
```

Fechar com a capa plástica do DB-9.

**Passo 7 — Terminar a alimentação**

No fio vermelho (PWR, pino J1-1): inserir porta-fusível inline com fusível 5A em série. Terminar com terminal adequado para a fonte (borne, espada ou banana, conforme a fonte disponível no box).

No fio preto (GND, pino J1-2): terminar direto sem fusível.

**Passo 8 — Aplicar tubo termo-retrátil**

Deslizar e retrair o tubo em todas as junções expostas. Especialmente nas saídas do conector EN3 e nas soldas/crimpagens do DB-9.

---

#### Teste de continuidade pré-energização (obrigatório)

Antes de conectar qualquer coisa ao receptor:

```
Multímetro em modo buzzer/continuidade:

[ ] J1 pino 1  → fio vermelho → terminal fusível → 12V     (sem abrir o fusível)
[ ] J1 pino 2  → fio preto   → terminal GND
[ ] J1 pino 5  → fio amarelo → DB-9 pino 2
[ ] J1 pino 6  → fio branco  → DB-9 pino 3
[ ] J1 pino 11 → fio verde   → DB-9 pino 5

Multímetro em modo resistência — checar curtos:
[ ] Entre pino 1 (PWR) e pino 2 (GND): deve ser > 1 MΩ
[ ] Entre qualquer sinal serial e PWR: deve ser > 1 MΩ
```

Só conectar ao receptor após todos os pontos passarem.

---

#### Primeiro teste com o receptor

Após aprovação no teste de continuidade:

1. Conectar o cabo ao receptor (rosca do EN3 — apertar com a mão, não usar ferramenta)
2. Conectar o DB-9 ao adaptador USB-Serial
3. Conectar o adaptador USB ao servidor base
4. Aplicar 12V — verificar se LED do receptor acende
5. Abrir terminal serial:

```bash
sudo minicom -D /dev/ttyUSB0 -b 9600
# baud padrão de fábrica é 9600
# se não aparecer nada, tentar 115200
```

6. Digitar `log versiona once` — se retornar dados, o cabo está funcionando.

---

### 4.4 Adaptadores USB-Serial (DB-9 → USB)

Necessários em três pontos do sistema:

| Ponto | Dispositivo | Sentido |
|---|---|---|
| NovAtel COM1 → servidor base | DB-9 fêmea → USB-A | RTCM out |
| Ellipse Port A → Jetson | DB-9 fêmea → USB-A | RTCM in |
| Ellipse Port B → Jetson | DB-9 fêmea → USB-A | sbgECom out |

**Chip recomendado:** FTDI FT232 (mais estável em campo) sobre CH340.

**Antes de comprar:** inventariar os adaptadores já disponíveis na equipe:
```bash
lsusb | grep -i "ftdi\|ch340\|prolific"
udevadm info /dev/ttyUSB0 | grep -i "id_vendor\|id_model"
```

Não misturar chips diferentes se possível — facilita as regras udev.

### 4.5 Identificação das portas seriais no Linux

Após conectar os adaptadores USB-Serial:

```bash
# Listar portas seriais disponíveis
ls /dev/ttyUSB*

# Ver qual dispositivo é qual
udevadm info /dev/ttyUSB0 | grep -i "id_vendor\|id_model"

# Criar regras udev para nomes fixos
# No servidor base:
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", SYMLINK+="ttyUSB_novatel"' \
  | sudo tee /etc/udev/rules.d/99-novatel.rules

# Na Jetson:
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", SYMLINK+="ttyUSB_ellipse_rtcm"' \
  | sudo tee /etc/udev/rules.d/99-ellipse-rtcm.rules
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="ZZZZ", ATTRS{idProduct}=="WWWW", SYMLINK+="ttyUSB_ellipse_ecom"' \
  | sudo tee /etc/udev/rules.d/99-ellipse-ecom.rules

sudo udevadm control --reload-rules
```

> Substituir `XXXX`, `YYYY`, `ZZZZ`, `WWWW` pelos valores reais retornados pelo `udevadm info`. Sem essas regras, a ordem de enumeração pelo kernel é não determinística — o `ttyUSB0` pode virar `ttyUSB1` após um reboot, quebrando os serviços systemd silenciosamente em campo.

### 4.6 Alimentação da NovAtel

A NovAtel SMART-V1 aceita **9–28 VDC**, consumo de 350 mA.

- **Opção A:** fonte DC de bancada 12V/3A no box — mais estável, evita ruído elétrico
- **Opção B:** bateria 12V do carro via fusível 5A no fio BATT+

O fusível 5A no fio vermelho (PWR, pino J1-1) é **obrigatório** — o SMART-V1 não tem proteção interna contra curto.

---

## 5. Integração de software — explicação detalhada

### 5.1 Configuração única da NovAtel (pré-evento)

Conectar ao CDU via notebook (Windows) ou minicom (Linux) na COM1:

```bash
# Linux — abrir console serial (baud padrão de fábrica: 9600)
sudo minicom -D /dev/ttyUSB_novatel -b 9600
```

**Passo 1 — Reconfigurar baud rate (padrão de fábrica é 9600):**
```
SERIALCONFIG COM1 115200
SAVECONFIG
# Reconectar em 115200 baud
```

**Passo 2 — Configurar porta de saída RTCM:**
```
INTERFACEMODE COM1 NONE RTCM
```

**Passo 3 — Configurar posição da base (ver Seção 5.1.A e 5.1.B abaixo)**

**Passo 4 — Ativar logs RTCM na COM1:**
```
LOG COM1 RTCMDATA1 ONTIME 1
LOG COM1 RTCMDATA3 ONTIME 10
LOG COM1 RTCMDATA22 ONTIME 10
```

**Passo 5 — Verificar convergência (se survey-in):**
```
log posavea once
```
Aguardar `pos type` mudar para `FIX`.

**Passo 6 — Salvar posição para backup:**
```
log refstationa once
```
Anotar lat/lon/alt. Para recuperação de emergência:
```
FIX POSITION <lat> <lon> <alt>
```

**Passo 7 — Verificar RTCM saindo:**
```
log com1 rtcmdata3a once
```

**Passo 8 — Salvar na flash:**
```
SAVECONFIG
```

---

### 5.1.A Opção A — Survey-in automático (dia do evento, qualquer local)

```
FIX AUTO 0.5 900
```

Parâmetros: desvio padrão máximo 0,5 m, tempo mínimo 900 s (15 min).

**Limitação:** posição da base com incerteza de ~1–3 m propaga como erro sistemático. O rover corrige erros relativos com ~20 cm, mas se a base errar 2 m, o rover também erra 2 m — de forma consistente, tolerável para análise de trajetória relativa.

---

### 5.1.B Opção B — Posição conhecida via IBGE-PPP (recomendada para kartódromo fixo)

O serviço **IBGE-PPP** (gratuito) determina a posição da antena com precisão de **2–5 cm**, eliminando o erro sistemático.

**Quando fazer:** uma única vez, com a antena na posição definitiva no kartódromo.

**Fluxo:**
```
1. Posicionar antena exatamente onde ficará em competição
2. Coletar dados brutos por 1 hora contínua
3. Exportar RINEX
4. Enviar para https://www.ibge.gov.br/geociencias/ppp
5. Receber coordenadas com ~2–5 cm por e-mail (5–30 min)
6. Inserir via FIX POSITION — válido para todos os eventos no mesmo local
```

**Coleta RINEX:**
```bash
# Capturar dados brutos da serial para arquivo (1 hora)
stty -F /dev/ttyUSB_novatel 115200 raw
cat /dev/ttyUSB_novatel > /home/ubuntu/novatel_raw_$(date +%Y%m%d_%H%M).bin
```

```
LOG COM1 RANGEB ONTIME 30
LOG COM1 RAWEPHEMB ONCHANGED
SAVECONFIG
```

**Converter para RINEX:**
```bash
sudo apt install rtklib
convbin -r novatel -o novatel_obs.obs -n novatel_nav.nav novatel_raw_YYYYMMDD_HHMM.bin
```

**Inserir coordenadas após retorno do IBGE-PPP:**
```
FIX POSITION -22.XXXXXX -47.YYYYYY ZZZ.ZZ
log posavea once   # confirmar FIXED_POS
SAVECONFIG
```

**Comparação das opções:**

| | Opção A (survey-in) | Opção B (IBGE-PPP) |
|---|---|---|
| Erro da base | ~1–3 m | ~2–5 cm |
| Erro do rover | ~20 cm + viés 1–3 m | ~20 cm (sem viés) |
| Tempo no dia do evento | 15–30 min de espera | 0 min (posição salva) |
| Esforço único | nenhum | 1h coleta + envio IBGE |
| Ideal para | eventos em locais novos | kartódromo fixo UNICAMP |

---

### 5.2 Configuração única do Ellipse 2 (sbgCenter — laboratório)

1. Conectar Ellipse ao notebook via USB
2. sbgCenter → painel **Assignment**
3. **Port A → RTCM Input**
4. **Port B → sbgECom Output**
5. Inserir **lever arm**: distância (X, Y, Z) em metros entre centro de fase da antena GNSS e centro do Ellipse — medir com trena, precisão de milímetros
6. Definir **orientação de montagem** do sensor no carro
7. Salvar na flash

> **Por que o lever arm importa:** o Ellipse funde IMU com GNSS assumindo que os dois centros coincidem. Um lever arm não calibrado de 20 cm pode introduzir erro de vários metros em curva fechada.

---

### 5.3 Serviço no servidor base — rtcm-relay

```bash
sudo apt install rtklib
```

```ini
# /etc/systemd/system/rtcm-relay.service
[Unit]
Description=RTCM Relay — NovAtel serial to TCP server
After=network.target

[Service]
ExecStart=/usr/bin/str2str \
  -in serial:///dev/ttyUSB_novatel:115200 \
  -out tcpsvr://:2101
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rtcm-relay
sudo systemctl start rtcm-relay
sudo systemctl status rtcm-relay
```

**Verificar:**
```bash
sudo journalctl -u rtcm-relay -f
nc 127.0.0.1 2101 | xxd | head -5
# Bytes RTCM começam com D3 (0xD3)
```

---

### 5.4 Serviço na Jetson — rtcm-client

```ini
# /etc/systemd/system/rtcm-client.service
[Unit]
Description=RTCM Client — TCP box to Ellipse Port A serial
After=network.target

[Service]
ExecStart=/usr/bin/str2str \
  -in tcpcli://143.106.207.21:2101 \
  -out serial:///dev/ttyUSB_ellipse_rtcm:115200
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rtcm-client
sudo systemctl start rtcm-client
```

**Verificar:**
```bash
sudo journalctl -u rtcm-client -f
sudo cat /dev/ttyUSB_ellipse_rtcm | xxd | head -10
```

---

### 5.5 Integração direta no telemetry-edge — parser sbgECom em Rust

Sem ROS2. O `telemetry-edge` abre `/dev/ttyUSB_ellipse_ecom` diretamente, parseia o protocolo binário sbgECom e ingere os frames no mesmo pipeline do CAN bus.

#### 5.5.1 Protocolo sbgECom — estrutura do frame

```
┌────────┬────────┬─────┬───────┬──────────────┬──────────────┬──────┬─────┐
│ SYNC1  │ SYNC2  │ MSG │ CLASS │   LENGTH (2) │  DATA (var)  │ CRC  │ ETX │
│  0xFF  │  0x5A  │ 1B  │  1B   │   uint16 LE  │  0–4086 B    │  2B  │0x33 │
└────────┴────────┴─────┴───────┴──────────────┴──────────────┴──────┴─────┘
```

- CRC-16 sobre `MSG..DATA`, polinômio `0x8408`, valor inicial `0`
- Todos os campos multi-byte em little-endian
- CLASS para mensagens de saída = `0x00`

#### 5.5.2 Mensagens relevantes

| Mensagem | MSG ID | Payload | Uso |
|---|---|---|---|
| `SBG_ECOM_LOG_STATUS` | 0x01 | 27 B | Health geral, status das portas |
| `SBG_ECOM_LOG_UTC_TIME` | 0x02 | 33 B | Timestamp interno → UTC/GPS ToW |
| `SBG_ECOM_LOG_IMU_SHORT` | 0x16 | 32 B | Aceleração + gyro int32 — **preferir** |
| `SBG_ECOM_LOG_EKF_EULER` | 0x06 | 32 B | Roll, pitch, yaw + 1σ |
| `SBG_ECOM_LOG_EKF_QUAT` | 0x07 | 36 B | Quaternion W,X,Y,Z + 1σ |
| `SBG_ECOM_LOG_EKF_NAV` | 0x08 | 72 B | Posição NED + velocidade NED + 1σ |
| `SBG_ECOM_LOG_EKF_VEL_BODY` | 0x36 | 32 B | Velocidade no frame do veículo |
| `SBG_ECOM_LOG_EKF_ROT_ACCEL_BODY` | 0x34 | 32 B | Aceleração + rates pós-EKF — **ideal para SLAM** |
| `SBG_ECOM_LOG_GPS1_POS` | 0x0E | 59 B | Posição GNSS bruta, tipo RTK, DIFF_AGE |
| `SBG_ECOM_LOG_GPS1_VEL` | 0x0D | 44 B | Velocidade GNSS NED + course |

#### 5.5.3 Conversão IMU_SHORT

```
accel_m_s2 = accel_lsb as f32 / 1_048_576.0

# bit 10 = SBG_ECOM_IMU_GYROS_USE_HIGH_SCALE
if imu_status & (1 << 10) != 0 {
    rate_rad_s = rate_lsb as f32 / 12_304_174.0
} else {
    rate_rad_s = rate_lsb as f32 / 67_108_864.0
}

temp_c = temp_lsb as f32 / 256.0
```

#### 5.5.4 SOLUTION_STATUS

```
bits [0–3]  SOLUTION_MODE:
  0 = UNINITIALIZED
  1 = VERTICAL_GYRO
  2 = AHRS
  4 = NAV_POSITION  ← estado desejado em prova

bit 4   ATTITUDE_VALID
bit 5   HEADING_VALID
bit 6   VELOCITY_VALID
bit 7   POSITION_VALID
bit 11  GPS1_POS_USED
bit 27  ALIGN_VALID
```

#### 5.5.5 GPS1_POS — status RTK

```
bits [0–5]  GPS_POS_STATUS: 0 = SOL_COMPUTED

bits [6–11] GPS_POS_TYPE:
  2 = SINGLE       (~1–3 m)
  3 = PSRDIFF      (DGPS)
  6 = RTK_FLOAT    (~20 cm) ← esperado com RT-20
  7 = RTK_INT      (~2 cm)
```

#### 5.5.6 Estrutura do parser em Rust

```
src/
├── ins/
│   ├── mod.rs
│   ├── frame.rs      # parser frame sbgECom: sync, CRC, dispatch
│   ├── crc.rs        # CRC-16 poly 0x8408
│   ├── messages.rs   # structs EkfNav, ImuShort, etc.
│   └── reader.rs     # task tokio: lê serial, emite InsEvent
└── main.rs
```

**`crc.rs`:**
```rust
pub fn sbg_crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if crc & 1 != 0 { crc = (crc >> 1) ^ 0x8408; }
            else { crc >>= 1; }
        }
    }
    crc
}
```

**`frame.rs`:**
```rust
use crate::ins::crc::sbg_crc16;

const SYNC1: u8 = 0xFF;
const SYNC2: u8 = 0x5A;
const ETX:   u8 = 0x33;
const HEADER_SIZE: usize = 6;
const FOOTER_SIZE: usize = 3;

#[derive(Debug)]
pub struct SbgFrame {
    pub msg_id: u8,
    pub class:  u8,
    pub data:   Vec<u8>,
}

pub struct FrameParser { buf: Vec<u8> }

impl FrameParser {
    pub fn new() -> Self { Self { buf: Vec::with_capacity(512) } }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SbgFrame> {
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            let Some(pos) = self.buf.windows(2).position(|w| w == [SYNC1, SYNC2]) else {
                self.buf.clear(); break;
            };
            if pos > 0 { self.buf.drain(..pos); }
            if self.buf.len() < HEADER_SIZE { break; }
            let length = u16::from_le_bytes([self.buf[4], self.buf[5]]) as usize;
            let total  = HEADER_SIZE + length + FOOTER_SIZE;
            if self.buf.len() < total { break; }
            if self.buf[total - 1] != ETX { self.buf.drain(..2); continue; }
            let crc_data = &self.buf[2..HEADER_SIZE + length];
            let crc_calc = sbg_crc16(crc_data);
            let crc_recv = u16::from_le_bytes([
                self.buf[HEADER_SIZE + length],
                self.buf[HEADER_SIZE + length + 1],
            ]);
            if crc_calc == crc_recv {
                frames.push(SbgFrame {
                    msg_id: self.buf[2],
                    class:  self.buf[3],
                    data:   self.buf[HEADER_SIZE..HEADER_SIZE + length].to_vec(),
                });
            }
            self.buf.drain(..total);
        }
        frames
    }
}
```

**`messages.rs` — structs principais:**
```rust
#[derive(Debug, Clone)]
pub struct ImuShort {
    pub timestamp_us: u32, pub imu_status: u16,
    pub accel_x_lsb: i32, pub accel_y_lsb: i32, pub accel_z_lsb: i32,
    pub rate_x_lsb:  i32, pub rate_y_lsb:  i32, pub rate_z_lsb:  i32,
    pub temp_lsb: i16,
}
impl ImuShort {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 32 { return None; }
        Some(Self {
            timestamp_us: u32::from_le_bytes(d[0..4].try_into().ok()?),
            imu_status:   u16::from_le_bytes(d[4..6].try_into().ok()?),
            accel_x_lsb:  i32::from_le_bytes(d[6..10].try_into().ok()?),
            accel_y_lsb:  i32::from_le_bytes(d[10..14].try_into().ok()?),
            accel_z_lsb:  i32::from_le_bytes(d[14..18].try_into().ok()?),
            rate_x_lsb:   i32::from_le_bytes(d[18..22].try_into().ok()?),
            rate_y_lsb:   i32::from_le_bytes(d[22..26].try_into().ok()?),
            rate_z_lsb:   i32::from_le_bytes(d[26..30].try_into().ok()?),
            temp_lsb:      i16::from_le_bytes(d[30..32].try_into().ok()?),
        })
    }
    pub fn accel_ms2(&self) -> [f32; 3] {
        let s = 1_048_576.0_f32;
        [self.accel_x_lsb as f32/s, self.accel_y_lsb as f32/s, self.accel_z_lsb as f32/s]
    }
    pub fn rate_rad_s(&self) -> [f32; 3] {
        let s = if self.imu_status & (1<<10) != 0 { 12_304_174.0_f32 } else { 67_108_864.0_f32 };
        [self.rate_x_lsb as f32/s, self.rate_y_lsb as f32/s, self.rate_z_lsb as f32/s]
    }
}

#[derive(Debug, Clone)]
pub struct EkfNav {
    pub timestamp_us: u32,
    pub vel_n_ms: f32, pub vel_e_ms: f32, pub vel_d_ms: f32,
    pub vel_n_acc: f32, pub vel_e_acc: f32, pub vel_d_acc: f32,
    pub latitude_deg: f64, pub longitude_deg: f64, pub altitude_m: f64,
    pub undulation_m: f32,
    pub lat_acc_m: f32, pub lon_acc_m: f32, pub alt_acc_m: f32,
    pub solution_status: u32,
}
impl EkfNav {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 72 { return None; }
        Some(Self {
            timestamp_us:    u32::from_le_bytes(d[0..4].try_into().ok()?),
            vel_n_ms:        f32::from_le_bytes(d[4..8].try_into().ok()?),
            vel_e_ms:        f32::from_le_bytes(d[8..12].try_into().ok()?),
            vel_d_ms:        f32::from_le_bytes(d[12..16].try_into().ok()?),
            vel_n_acc:       f32::from_le_bytes(d[16..20].try_into().ok()?),
            vel_e_acc:       f32::from_le_bytes(d[20..24].try_into().ok()?),
            vel_d_acc:       f32::from_le_bytes(d[24..28].try_into().ok()?),
            latitude_deg:    f64::from_le_bytes(d[28..36].try_into().ok()?),
            longitude_deg:   f64::from_le_bytes(d[36..44].try_into().ok()?),
            altitude_m:      f64::from_le_bytes(d[44..52].try_into().ok()?),
            undulation_m:    f32::from_le_bytes(d[52..56].try_into().ok()?),
            lat_acc_m:       f32::from_le_bytes(d[56..60].try_into().ok()?),
            lon_acc_m:       f32::from_le_bytes(d[60..64].try_into().ok()?),
            alt_acc_m:       f32::from_le_bytes(d[64..68].try_into().ok()?),
            solution_status: u32::from_le_bytes(d[68..72].try_into().ok()?),
        })
    }
    pub fn solution_mode(&self) -> u8 { (self.solution_status & 0xF) as u8 }
    pub fn position_valid(&self) -> bool { self.solution_status & (1 << 7) != 0 }
    pub fn gps1_pos_used(&self) -> bool  { self.solution_status & (1 << 11) != 0 }
}

#[derive(Debug, Clone)]
pub struct Gps1Pos {
    pub timestamp_us: u32, pub status_type: u32, pub tow_ms: u32,
    pub latitude_deg: f64, pub longitude_deg: f64, pub altitude_m: f64,
    pub undulation_m: f32,
    pub lat_acc_m: f32, pub lon_acc_m: f32, pub alt_acc_m: f32,
    pub num_sv_used: u8, pub base_station_id: u16, pub diff_age_cs: u16,
}
impl Gps1Pos {
    pub fn parse(d: &[u8]) -> Option<Self> {
        if d.len() < 57 { return None; }
        Some(Self {
            timestamp_us:     u32::from_le_bytes(d[0..4].try_into().ok()?),
            status_type:      u32::from_le_bytes(d[4..8].try_into().ok()?),
            tow_ms:           u32::from_le_bytes(d[8..12].try_into().ok()?),
            latitude_deg:     f64::from_le_bytes(d[12..20].try_into().ok()?),
            longitude_deg:    f64::from_le_bytes(d[20..28].try_into().ok()?),
            altitude_m:       f64::from_le_bytes(d[28..36].try_into().ok()?),
            undulation_m:     f32::from_le_bytes(d[36..40].try_into().ok()?),
            lat_acc_m:        f32::from_le_bytes(d[40..44].try_into().ok()?),
            lon_acc_m:        f32::from_le_bytes(d[44..48].try_into().ok()?),
            alt_acc_m:        f32::from_le_bytes(d[48..52].try_into().ok()?),
            num_sv_used:      d[52],
            base_station_id:  u16::from_le_bytes(d[53..55].try_into().ok()?),
            diff_age_cs:      u16::from_le_bytes(d[55..57].try_into().ok()?),
        })
    }
    pub fn pos_type(&self) -> u8 { ((self.status_type >> 6) & 0x3F) as u8 }
    pub fn is_rtk_float(&self) -> bool { self.pos_type() == 6 }
    pub fn is_rtk_int(&self)   -> bool { self.pos_type() == 7 }
    pub fn diff_age_s(&self) -> Option<f32> {
        if self.diff_age_cs == 0xFFFF { None }
        else { Some(self.diff_age_cs as f32 / 100.0) }
    }
}
```

**`reader.rs`:**
```rust
use tokio::io::AsyncReadExt;
use tokio_serial::SerialPortBuilderExt;
use crate::ins::{frame::FrameParser, messages::*};

pub enum InsEvent {
    Imu(ImuShort), EkfNav(EkfNav), Gps1Pos(Gps1Pos),
}

pub async fn ins_reader_task(
    port_path: &str, baud: u32,
    tx: tokio::sync::mpsc::Sender<InsEvent>,
) -> anyhow::Result<()> {
    let mut port = tokio_serial::new(port_path, baud).open_native_async()?;
    let mut parser = FrameParser::new();
    let mut buf = [0u8; 512];
    loop {
        let n = port.read(&mut buf).await?;
        for frame in parser.feed(&buf[..n]) {
            if frame.class != 0x00 { continue; }
            let event = match frame.msg_id {
                0x16 => ImuShort::parse(&frame.data).map(InsEvent::Imu),
                0x08 => EkfNav::parse(&frame.data).map(InsEvent::EkfNav),
                0x0E => Gps1Pos::parse(&frame.data).map(InsEvent::Gps1Pos),
                _    => None,
            };
            if let Some(ev) = event { let _ = tx.try_send(ev); }
        }
    }
}
```

**`Cargo.toml`:**
```toml
[dependencies]
tokio        = { version = "1", features = ["full"] }
tokio-serial = "5"
anyhow       = "1"
tracing      = "0.1"
```

#### 5.5.7 Verificar saúde do parser em campo

```bash
sudo cat /dev/ttyUSB_ellipse_ecom | xxd | grep "ff5a" | head -20
# Verificar nos logs: EKF_NAV com solution_mode=4, GPS1_POS com pos_type=6, diff_age < 5s
```

---

## 6. Fluxo completo no dia da prova

### Com Opção A (survey-in)
```
T-40 min  Posicionar antena NovAtel no box (visada livre)
T-38 min  Ligar NovAtel, conectar serial ao servidor base
T-37 min  sudo systemctl start rtcm-relay
T-37 min  FIX AUTO 0.5 900
T-22 min  log posavea — aguardar FIX
T-20 min  Verificar rtcmdata3 saindo
T-18 min  sudo systemctl start rtcm-client (Jetson)
T-15 min  Iniciar telemetry-edge (Jetson)
T-12 min  Verificar logs: GPS1_POS pos_type=6 (RTK_FLOAT) nos logs do telemetry-edge
T-5  min  Confirmar RTK_FLOAT estável, diff_age < 5 s
T-0       Prova
```

### Com Opção B (FIX POSITION — kartódromo fixo)
```
T-20 min  Posicionar antena na marca definitiva
T-18 min  Ligar NovAtel — FIX POSITION já ativo da flash
T-17 min  sudo systemctl start rtcm-relay
T-15 min  sudo systemctl start rtcm-client (Jetson)
T-12 min  Iniciar telemetry-edge (Jetson)
T-10 min  Verificar logs: GPS1_POS pos_type=6 (RTK_FLOAT) nos logs do telemetry-edge
T-5  min  Confirmar RTK_FLOAT estável, diff_age < 5 s
T-0       Prova
```

---

## 7. Checklist de campo (pré-prova)

```
CABO E HARDWARE
[ ] Cabo Switchcraft 18p montado e testado (continuidade + sem curtos)
[ ] NovAtel posicionada com visada livre (>10° horizonte)
[ ] NovAtel alimentada (9–28V, fusível 5A no fio PWR)
[ ] Cabo COM1 (DB-9) conectado ao adaptador USB-Serial no servidor base
[ ] /dev/ttyUSB_novatel presente no servidor (ls /dev/ttyUSB*)

CONFIGURAÇÃO DA BASE
[ ] baud rate NovAtel em 115200 (SERIALCONFIG COM1 115200)
[ ] Posição da base: FIX POSITION (Opção B) ou FIX AUTO 0.5 900 (Opção A)
[ ] log posavea confirmando FIXED_POS ou FIX convergido
[ ] rtcmdata3 saindo pela COM1

REDE E SERVIÇOS
[ ] rtcm-relay ativo no servidor (systemctl status rtcm-relay)
[ ] Rede local box ↔ carro ativa (ping 143.106.207.93 do servidor)
[ ] rtcm-client ativo na Jetson (systemctl status rtcm-client)

ELLIPSE
[ ] Port A conectada a /dev/ttyUSB_ellipse_rtcm na Jetson
[ ] Port B conectada a /dev/ttyUSB_ellipse_ecom na Jetson
[ ] telemetry-edge rodando na Jetson
[ ] Logs confirmando GPS1_POS pos_type=6 (RTK_FLOAT) e diff_age < 5 s

BACKUP
[ ] Posição da base anotada (log refstationa) para recuperação de emergência
```

---

## 8. Limitações e upgrades futuros

**Precisão ~20 cm (RT-20, L1 only):** upgrade para u-blox F9P (~R$800) mantém todo o software e entrega 1–2 cm.

**Dependência do link TCP box ↔ carro:** se cair, o Ellipse degrada para GPS autônomo. O `rtcm-client` tem `Restart=always`. Mitigação futura: rádio serial dedicado como canal de backup.

**Posição da base (Opção A):** incerteza de ~1–3 m propaga como erro sistemático consistente. Resolvido com Opção B para kartódromo fixo.

**Posição da base (Opção B):** coordenada IBGE-PPP válida enquanto a antena for posicionada no mesmo ponto físico. Marcar o ponto no chão (fita, parafuso, pintura) para garantir repetibilidade.

---

## 9. Referências

### Hardware — NovAtel SMART-V1

- **Manual OEMV Family completo (om-20000093 Rev 13)** — fonte primária para pinagem, configuração de base e comandos:  
  https://hexagondownloads.blob.core.windows.net/public/Novatel/assets/Documents/Manuals/om-20000093/om-20000093.pdf  
  → Seção A.9.2.1, Tabela 32: pinout cabo USB 18 pinos (p. 168)  
  → Seção A.9.2.3, Tabela 34: pinout cabo RS-422 18 pinos (p. 169)  
  → Tabela 35: cores dos fios bare tagged (p. 170)  
  → Seção 4.3.1: configuração de base station (p. 60)  
  → Seção 4.3.2: configuração de rover station (p. 61)

- **Página de produto SMART-V1 (NovAtel — produto descontinuado):**  
  https://novatel.com/support/previous-generation-products-drop-down/previous-generation-products/smart-v1

- **Página de produto OEMV-1 (NovAtel — produto descontinuado):**  
  https://novatel.com/support/previous-generation-products-drop-down/previous-generation-products/oemv-1-receiver

- **Manual SMART Antenna (geração anterior ao SMART-V1) — ManualsLib, pinout cabo RS-232:**  
  https://www.manualslib.com/manual/113424/Novatel-Smart-Antenna.html  
  → Página 17: variações de cabo e part numbers  
  → Página 38: connector pin assignments  
  → Página 39: RS-232 6-pin connector pinouts

- **Documentação SMART Antenna Interface Cable (geração OEM7 — referência para comparação):**  
  https://docs.novatel.com/OEM7/Content/Technical_Specs_Receiver/SMART7_IO_Cable.htm

### Hardware — Conector Switchcraft

- **Série EN3 Switchcraft (conector circular 18 pinos identificado no receptor):**  
  https://www.switchcraft.com/en3-series  
  *(verificar datasheet EN3C18F para confirmar travamento por rosca antes de comprar)*

### Software — SBG Systems Ellipse 2

- **Documentação sbgECom (protocolo binário, structs, CRC, mensagens):**  
  https://developer.sbg-systems.com/sbgECom/5.1/

- **Configuração RTK no Ellipse 2 (RTCM input, lever arm, sbgCenter):**  
  https://support.sbg-systems.com/sc/el/latest/how-to-articles/configure-rtk

### Software — RTKLIB

- **Manual str2str (relay serial → TCP):**  
  https://rtkexplorer.com/pdfs/rtklib_manual.pdf

- **Repositório RTKLIB:**  
  https://github.com/tomojitakasu/RTKLIB

### Posicionamento da base — IBGE-PPP

- **Serviço IBGE-PPP (pós-processamento gratuito, precisão 2–5 cm):**  
  https://www.ibge.gov.br/geociencias/ppp

---

*Unicamp E-Racing — Divisão de Telemetria e Sistemas Embarcados 2026*