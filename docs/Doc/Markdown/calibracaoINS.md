# Plano de Calibração – INS SBG Ellipse 2-D (FSAE)

**Status:** Acelerômetro ✓ concluído · GNSS e magnetômetro pendentes

---

## 1. Calibração GNSS (dual antenna)

> O Ellipse 2-D usa duas antenas para calcular heading por diferença de fase. Não é uma calibração de coleta de dados — é uma configuração de geometria. Qualquer erro de medição vira erro direto de yaw.

### 1.1 Montagem das antenas

- O INS deve estar na posição definitiva no chassi antes de qualquer medição
- As antenas devem ser fixadas rigidamente ao chassi, sem folga ou flexão
- Sem possibilidade de movimentação relativa entre elas ou em relação ao INS
- Alinhar as antenas com os eixos do veículo sempre que possível

### 1.2 Medição dos lever arms

> Esta etapa pode ser realizada com o carro desmontado ou em montagem parcial, desde que as posições finais das antenas e do INS já estejam definidas e fixas.

- Medir com fita métrica a posição de cada antena em relação ao INS (X, Y, Z)
  - X → deslocamento longitudinal (frente/trás)
  - Y → deslocamento lateral (esquerda/direita)
  - Z → deslocamento vertical (cima/baixo)
- Fazer isso para a **antena primária** e para a **antena secundária** separadamente
- Manter baseline (distância entre antenas) de no mínimo ~0,5 m — quanto maior, melhor a precisão de heading
- Respeitar os limites mínimos e máximos especificados no Hardware Manual do Ellipse 2

### 1.3 Configuração no sbgCenter

- Aba **Aiding** → GNSS Model: `Internal`
- Informar os lever arms medidos: Primary Lever Arm (X, Y, Z) e Secondary Lever Arm (X, Y, Z)
- Marcar a opção "The primary antenna lever arm has been measured precisely"
- Dual Antenna Mode: `Precise lever arm`
- Salvar e aplicar as configurações

### 1.4 Manobras de convergência em campo

- O veículo deve estar em movimento — velocidade mínima de **2,5 m/s** (~9 km/h)
- Realizar manobras em formato de **oito**: geram a dinâmica necessária para o sistema capturar observações e completar a calibração mais rapidamente
- Campo aberto com boa visibilidade de céu

### 1.5 Verificação

- Verificar no sbgCenter se o heading está convergindo com a orientação real do veículo
- Verificar se o status do sistema indica solução de heading válida (sem flags de erro)
- Repetir a medição dos lever arms se o heading apresentar desvio consistente

**Gráfico de velocidade não exibe dados — possíveis causas:**

- **Data Output não configurado:** na aba Data Output do sbgCenter, verificar se `GPS1 Velocity` está habilitado ("On New Data" ou com frequência em Hz). Se estiver como "Disabled", o INS não transmite o dado e o gráfico fica vazio
- **Baudrate inadequado:** comunicação parcial pode causar perda de pacotes. Confirmar que o baudrate está em 230400 — valores abaixo de 19200 não são recomendados pelo sbgCenter
- **Fix GNSS não estabelecido:** a velocidade vem do receptor GNSS, não do IMU. Sem boa visibilidade de céu ou sem fix estabelecido, o dado não chega. A aceleração funciona independente pois vem diretamente do acelerômetro

---

## 2. Calibração do Magnetômetro

> A calibração do magnetômetro mapeia as distorções do campo magnético causadas pela estrutura metálica do próprio carro. Deve ser feita com o INS já montado definitivamente — qualquer mudança posterior na estrutura ou componentes invalida a calibração.

### 2.1 Preparação do ambiente

- INS já fixado na posição definitiva no veículo
- Veículo montado como ficará na competição (sem peças faltando ou provisórias)
- Realizar a calibração em área aberta, longe de estruturas metálicas, veículos e campos magnéticos externos
- Evitar proximidade de cabos de alta tensão ou motores elétricos

### 2.2 Iniciar a calibração

- Abrir o sbgCenter → conectar ao INS
- Navegar até a aba **Magnetometer**
- Iniciar o processo de calibração magnética na interface
- Aguardar o INS entrar em modo de coleta de dados

### 2.3 Escolha do modo de calibração

**Calibração 3D (recomendada)**
- Método sempre recomendado pela SBG Systems — oferece o melhor desempenho geral
- Exige movimentação do veículo nos três eixos (yaw, pitch e roll)
- Mais robusta para diferentes condições de operação
- É o modo adequado para o contexto de FSAE

**Calibração 2D (somente se não for possível movimentar em 3D)**
- Válida apenas dentro de um raio de 50 km do local onde foi realizada
- Exige fornecimento manual da data e localização exata (latitude, longitude e altitude) para compensar variações seculares do campo magnético terrestre
- Evitar sempre que possível

### 2.4 Manobras de cobertura (calibração 3D)

- Executar rotações completas em **yaw**: 2 a 3 voltas lentas e contínuas (360°)
- Variar **pitch** (inclinação frontal) e **roll** (inclinação lateral) — obrigatório para cobrir os três eixos na calibração 3D
- Manter movimentos suaves e constantes, sem paradas bruscas

### 2.5 Salvar a calibração

- Finalizar a coleta no sbgCenter
- Verificar o **score de qualidade** exibido — se ruim, repetir as manobras
- Salvar a calibração no INS via sbgCenter
- Anotar o score obtido para referência futura

### 2.6 Verificação

- Comparar o heading magnético com o heading GNSS (referência mais confiável)
- Se divergência consistente for maior que ~2°, repetir a calibração
- Repetir a calibração no local de competição se o ambiente magnético for diferente da oficina

---

## 3. Validação Final Integrada

Após ambas as calibrações concluídas, realizar validação com o veículo completo em pista:

- Verificar no sbgCenter se o sistema não apresenta flags de erro
- Comparar heading estimado com a direção real nas curvas
- Testar em situações de aceleração, frenagem e curva
- Documentar os valores finais de lever arms e misalignment angles utilizados
- Guardar o arquivo de configuração exportado do sbgCenter como backup

---

## Referências

- Hardware Manual: Ellipse 2 – ELLIPSE2HM.1.3
- Playlist oficial SBG Systems "How to" (configuração e calibração): https://www.youtube.com/playlist?list=PLEETzXwyRY3-qx7-fojnff5pAM5gMArI7
- Documentação interna da equipe: Configurações INS (PDF)