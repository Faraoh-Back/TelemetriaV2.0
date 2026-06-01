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

### 1.4 Verificação em campo

- Realizar teste em campo aberto, com boa visibilidade de céu
- Verificar no sbgCenter se o heading está convergindo com a orientação real do veículo
- Verificar se o status do sistema indica solução de heading válida (sem flags de erro)
- Repetir a medição dos lever arms se o heading apresentar desvio consistente

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

### 2.3 Manobras de cobertura

- Executar rotações completas em **yaw**: 2 a 3 voltas lentas e contínuas (360°)
- Variar **pitch** (inclinação frontal) e **roll** (inclinação lateral) se a situação permitir — melhora a qualidade da calibração 3D
- Manter movimentos suaves e constantes, sem paradas bruscas
- O modo de calibração 3D (`calibration.mode: 2`) requer cobertura nos três eixos

### 2.4 Salvar a calibração

- Finalizar a coleta no sbgCenter
- Verificar o **score de qualidade** exibido — se ruim, repetir as manobras
- Salvar a calibração no INS via sbgCenter
- Anotar o score obtido para referência futura

### 2.5 Verificação

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