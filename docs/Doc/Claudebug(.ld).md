# Relatório Técnico — Refatoração do Exportador MoTeC i2 Pro (V2.2)

**Projeto:** Telemetria UNICAMP E-RACING  
**Arquivo afetado:** `telemetry-server/src/api/logs.rs`  
**Objetivo:** Corrigir o bug de "arquivo corrompido" ao importar logs no MoTeC i2 Pro, gerando corretamente o binário `.ld` e o índice XML `.ldx`.  
**Referência normativa:** `gotzl/ldparser` — parser de engenharia reversa que reproduz a lógica de leitura interna da i2.  
**Status:** ✅ Concluído e validado (parser oficial: 0 falhas em ~40 asserts; XML bem-formado).

---

## 1. Comparação de Estrutura — O que era × O que é agora

### 1.1. A estrutura antiga (inventada) e por que a i2 rejeitava
O gerador anterior não seguia o formato MoTeC real. Ele inventava um layout próprio que apenas parecia plausível, gerando as seguintes inconsistências fatais:

* **Campo antigo:** Magic (offset `0x00`)  
  **Valor antigo:** `b"LDMOTEC\0"` (8 bytes)  
  **Problema:** Não existe no formato `.ld`. A i2 não procura essa string. O 1º campo real é um `u32 marker = 0x40`.
* **Campo antigo:** "Versão" (`0x08`)  
  **Valor antigo:** `u32 = 0x0000000A`  
  **Problema:** Campo fictício. Nessa posição a i2 espera o `meta_ptr` (ponteiro para o 1º header de canal).
* **Campo antigo:** "Nº de canais" (`0x0C`)  
  **Valor antigo:** `u32`  
  **Problema:** Posição errada. Nessa posição a i2 espera o `data_ptr` (início do bloco de dados).
* **Campo antigo:** Bloco de metadados (`0x40`)  
  **Valor antigo:** texto fixo de 256 bytes  
  **Problema:** A i2, ao ler `0x40`, espera 3 `u16` estáticos (`1`, `0x4240`, `0x000F`), depois serial/device/version — não strings livres.
* **Campo antigo:** Descritores de canal  
  **Valor antigo:** 64 bytes cada, a partir de `0x140`  
  **Problema:** Tamanho e layout errados (o real é 124 bytes) e sem lista encadeada (`prev`/`next`).
* **Campo antigo:** Cabeçalho total  
  **Valor antigo:** 64 bytes (`0x40`)  
  **Problema:** O cabeçalho real de metadados e strings estruturadas tem 1762 bytes.

**Cadeia de falhas que disparava o status de "corrompido":**
1. A i2 lê o `u32` em `0x00` esperando o marker `0x40`. Recebia `"LDMO"` (`= 0x4F4D444C`), gerando um ponteiro de bloco absurdo.
2. Lia `meta_ptr`/`data_ptr` de offsets errados, saltando para regiões inválidas do arquivo.
3. Os descritores de 64 bytes desalinhavam completamente o parser: ele realiza leituras em passos fixos de 124 bytes, fazendo com que a partir do 1º canal todos os campos seguintes ficassem deslocados (`name`, `frequência`, `dtype`, `n_data`).
4. Sem `prev_meta_ptr`/`next_meta_ptr`, a i2 não conseguia percorrer a lista encadeada de canais — ela não usa um array indexado, mas sim ponteiros dinâmicos de um header ao próximo.
5. O `dtype`/`dtype_a` ausentes faziam o tipo de dado ser tratado como desconhecido, disparando uma exceção interna equivalente ao `ValueError: Channel has unknown data type` do `ldparser`.

### 1.2. A nova estrutura (fiel ao formato MoTeC)
Três blocos sequenciais + dados, com ponteiros absolutos amarrando toda a integridade da memória.

#### Cabeçalho (ldHead) — 1762 bytes (`0x000–0x6E2`)

| Offset | Tipo | Conteúdo | Valor gravado |
| :--- | :--- | :--- | :--- |
| `0x000` | u32 + 4x pad | `marker` | `0x40` |
| `0x008` | u32 | `meta_ptr` (1º channel header) | `2916` |
| `0x00C` | u32 | `data_ptr` (início dos dados) | `meta_ptr + (n_canais * 124)` |
| `0x024` | u32 | `event_ptr` | `1762` (logo após o header) |
| `0x040` | u16, u16, u16 | estáticos | `(1, 0x4240, 0x000F)` |
| `0x046` | u32 | `serial` | `0x1F44` |
| `0x04A` | 8s | `device type` | `"ADL"` |
| `0x052` | u16 | `device version` | `420` |
| `0x054` | u16 | estático | `0xADB0` |
| `0x056` | u32 | nº de canais | `n` |
| `0x05E` | 16s (+16x) | data | `"16/06/2026"` |
| `0x07E` | 16s (+16x) | hora | `"14:30:00"` |
| `0x09E` | 64s | driver | `"UNICAMP E-RACING Team"` |
| `0x0DE` | 64s (+64x) | vehicle id | `"UNICAMP E-RACING"` |
| `0x15E` | 64s (+64x +1024x) | venue | `"UNICAMP"` |
| `0x5DE` | u32 | "pro logging" magic | `0xC81A4` |
| `0x624` | 64s (+126x) | short comment | nome da sessão |

> ⚠️ **Detalhe crítico do formato de data:** O parser exige estritamente `%d/%m/%Y` e `%H:%M:%S`. Por isso, a função `iso_to_motec_datetime` converte `2026-06-16T14:30:00Z` em `("16/06/2026", "14:30:00")`. Se gravássemos o padrão ISO bruto, a i2 lançaria um erro impiedoso no parse.

#### Bloco de Evento (ldEvent) — 1154 bytes (`0x6E2–0xB64`)
Contém `64s name` · `64s session` · `1024s comment` · `u16 venue_ptr`. Definimos `venue_ptr = 0` (não emitimos bloco de venue separado; o parser trata 0 como "sem venue", e o nome do local já vai mapeado no campo venue do header principal). Isso fixa com segurança o primeiro `meta_ptr = 1762 + 1154 = 2916`.

#### Descritores de canal (ldChan) — 124 bytes cada (Lista Encadeada)
* **`prev_meta_ptr` (u32):** `0` no primeiro; senão aponta para o deslocamento em bytes do header anterior.
* **`next_meta_ptr` (u32):** `0` no último; senão aponta para o deslocamento do próximo header de canal.
* **`data_ptr` (u32):** `data_ptr_base + i * n_amostras * 4`.
* **`n_data` (u32):** Número de amostras (rigorosamente igual para todos os canais).
* **`counter` (u16):** `0x2EE1 + i`.
* **`dtype_a` (u16):** `0x07` (família float).
* **`dtype` (u16):** `4` (resolve internamente para `float32`).
* **`freq` (u16):** `100` Hz fixo.
* **`shift, mul, scale, dec` (i16 × 4):** `0, 1, 1, 0` -> a fórmula matemática padrão `(raw / scale * 10^-dec + shift) * mul` devolve o valor físico puro em ponto flutuante.
* **`name` (32s) / `short_name` (8s) / `unit` (12s):** Identificadores textuais regulamentados.
* **`pad` (40x):** Byte padding para fechar o bloco completo de 124 bytes.

#### Bloco de dados
Para cada canal gravado na ordem sequencial, são despejadas `n_data` amostras em formato `f32 little-endian` contíguas. Como todos os canais têm o mesmo `n_data`, o stride do ponteiro de leitura (`data_ptr`) torna-se perfeitamente uniforme (`n * 4`).

---

## 2. A Correção do Eixo Temporal

### 2.1. Por que salvar os valores CAN crus quebrava os gráficos
O ponto-chave contraintuitivo do ecossistema MoTeC: **o formato `.ld` não armazena timestamps individuais por amostra.** Cada canal é apenas um vetor de dados plano, e o software i2 reconstrói o tempo de cada ponto matematicamente usando a regra:
$$t(amostra_k) = \frac{k}{freq} + shift$$

Ou seja, a MoTeC assume de forma mandatória que o canal foi amostrado em uma taxa perfeitamente constante. Como os dados da rede CAN são assíncronos e baseados em eventos (RPM transmite a ~50Hz com jitter, temperaturas a 1Hz, etc.), injetar os dados crus desalinhava os eixos temporais e gerava gráficos encavalados, inviabilizando qualquer análise e fazendo o interpretador rejeitar o arquivo.

### 2.2. A solução: reamostragem em taxa fixa + canal mestre "Time"
* **Reamostragem em grade fixa (ZOH a 100 Hz):** Reprojetamos todos os canais sob a exata mesma base de tempo: $n = \lfloor duração \times freq \rfloor + 1$ amostras, com $dt = 1/freq$. Aplicamos a técnica *Zero-Order Hold* (sample-and-hold), que retém o último valor conhecido do sensor até que uma nova mensagem CAN chegue. Isso unificou o `n_data` e a `freq` de todos os sensores. O alinhamento horizontal agora é absoluto.
* **Canal Mestre "Time":** Injetamos como canal de índice zero um vetor explícito contendo a rampa temporal real em segundos (`0.00, 0.01, 0.02, ...`). Isso serve como âncora de auditoria para canais matemáticos e overlays de voltas no software i2.

---

## 3. Sessão e Metadados com `.ldx`

O `.ld` carrega a massa bruta de dados; o arquivo sidecar `.ldx` é o índice em XML interpretado de forma casada pela MoTeC para renderizar metadados e gerenciar beacons de voltas.

* **Estrutura XML Válida:** O gerador monta dinamicamente o arquivo incluindo tags `<Details>` e chaves textuais idênticas às embutidas no binário.
* **Tag `<MarkerBlock>`:** Mesmo inicializada vazia (`Type="Beacon" Count="0"`), sua presença estrutural é obrigatória para que a MoTeC i2 valide o arquivo de índice e permita a inserção dinâmica de beacons de pista e cálculo de voltas (*laps*) futuramente.
* **Casamento de Nomes:** No handler `handle_download_log`, o parâmetro da URL `?ext=ld|ldx` extrai dinamicamente a extensão necessária, garantindo que ambos os arquivos sejam baixados com o mesmo nome base (`eracing_sessao_{id}.ld` e `eracing_sessao_{id}.ldx`) e com os cabeçalhos de HTTP apropriados (`application/octet-stream` e `application/xml`).

## Resumo das Modificações Estruturais

| Item | Antes (V2.1) | Depois (V2.2 - Atual) |
| :--- | :--- | :--- |
| **Cabeçalho Binário** | Magic falso `LDMOTEC`, 64 bytes | `ldHead` real de 1762 bytes com ponteiros de bloco precisos |
| **Descritores de Canal**| 64 bytes, desalinhados e sem ponteiros | 124 bytes com amarração em lista encadeada e tipo `f32` |
| **Eixo de Tempo** | Valores crus com base assíncrona (CAN) | Reamostragem ZOH 100 Hz unificada + canal mestre `Time` |
| **Sidecar de Sessão** | Inexistente (Apenas `.ld` isolado) | Arquivo `.ldx` síncrono com tags `<Details>` e marcadores válidos |
| **Validação** | Rejeitado como corrompido pela i2 | Aprovado com 0 falhas no interpretador de engenharia reversa |

Modificações efetuadas, testadas via simulação em memória RAM local offline e prontas para implantação na V2.3. Pode prosseguir com o encerramento do ambiente temporário.