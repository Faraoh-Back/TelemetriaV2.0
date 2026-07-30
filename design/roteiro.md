# Overall
Sou Cairê, diretor técnico de driverless e hoje vou apresentar o design de Data Acquisition para vocês.
Nós decidimos nos tornar mais conservadores em nossas decisões, focando na redução de custos, na segurança do piloto e em ter como prioridade competir as provas dinâmicas deste ano. Como vocês verão em nossa apresentação, nossas inovações foram priorizando testar e conseguir muitos dados. Um exemplo é a nossa DAQ (Aquisição de Dados), que é totalmente funcional. Nós conseguimos manufaturar a pipeline inteira, desde ler o barramento CAN até gerar e armazenar os arquivos para uma futura análise de setup. Na parte elétrica, nós também focamos na nacionalização de grande parte dos componentes do carro.

# Low Voltage

# Data Acquisition (DAQ)
## Objetivos
Nós fizemos uma primeira versão (V1) com muitos erros no final do ano e, no começo do ano, nós planejamos a (V2), com uma evidente evolução em todas as nossas métricas dinâmicas.

### Missões
A telemetria tinha três missões centrais que nós projetamos para cumprir:
- **Segurança em tempo real:** Monitorar continuamente os parâmetros críticos do carro, assegurando a segurança do piloto e prevendo falhas elétricas ou térmicas antes que estressem o sistema.
- **Análise pós-teste:** Gerar arquivos de log MoTeC com os dados armazenados na pipeline de telemetria compatíveis com o software MoTeC i2 Pro imediatamente após o fim de cada teste. Isso permite que qualquer pessoa da equipe compare voltas, setups e analise dados com ferramentas profissionais sem custos adicionais.
- **Banco de dados geral:** Criar um sistema de persistência dual seguro para armazenar as métricas em diferentes formatos. Nós escolhemos salvar os dados de tempo real em um banco de dados relacional de séries temporais (TimescaleDB) com retenção de 7 dias e, após esse período, migrar os dados consolidados automaticamente para um banco local portátil (SQLite).

### Trade-offs
Sobre os trade-offs de projeto que nós decidimos fazer:
- **Latência vs. Alcance:** Nós decidimos prezar pela baixa latência em vez do alcance puro no início. Para obter latências consistentes na transmissão de frames. Por segurança
- **Simplicidade vs. Robustez:** Nós prezamos pela simplicidade operacional no uso, mesmo que a arquitetura interna da V2 tenha se tornado mais complexa do que a V1. Mas todas essas novas funcionalidades foram projetadas especificamente para resolver as falhas de inviabilidade e perda de dados que nós sofremos na V1.

## Planejamento
### Comparação V1 vs V2
No ano passado, nossa V1 rodava em Python na borda, transmitindo via MQTT e JSON sobre um broker intermediário. A latência inicial de `100ms` subia progressivamente à medida que a sessão de testes passava de 3 minutos, por um erro intrínseco ao broker. Não tínhamos sincronização confiável de tempo e salvávamos logs brutos em arquivos CSV locais sem segurança. A V2 foi totalmente reestruturada: reescrevemos o edge em Rust eficiente, passamos a nos comunicar via TCP bruto com `TCP_NODELAY` utilizando frames binários de `20 a 24 bytes` (sendo 20 bytes para frames CAN padrão e 24 bytes quando incluímos as métricas de rede a cada 1 segundo), alcançando latências estáveis de `1 ms a 49 ms (média de 20 ms)` e sem degradação. Implementamos sincronização ativa de tempo via Chrony `(precisão de ±0.1 ms)`, persistência dinâmica em TimescaleDB e SQLite permanente, e controle de comandos de emergência bidirecionais.

### Comparação Antena + Modelagem
Para as escolhas das antenas decidemos modelar pela equação de Friis as seguintes distâncias: 50, 150, 300 e 900 metros. E nossa decisão foi: no Box, nós usamos a antena painel direcional. Eu tomei essa decisão por conta de sua potência ser concentrada em um feixe estreito de 45 graus tanto horizontal quanto vertical. Isso nos dá um ganho de rádio de `15 dBi em 5 GHz` com uma margem de fading teórica de 24.5 dB. No veículo, nós mantivemos as antenas omnidirecionais padrão com ganho de `4 dBi em 5 GHz` que possuem diagrama toroidal de 360 graus, garantindo que a comunicação continue ativa mesmo com o carro rotacionando em curvas rápidas ou inclinando nas frenagens.

### Configuração da Rede - Física
Além disso, nós configuramos de forma otimizada a rede entre as duas antenas UniFi:
- **Wireless Meshing:** Nós ativamos e travamos manualmente a prioridade de uplink no AP do carro direto para o AP do Box. Isso transforma o rádio do carro em uma Wireless Bridge (Ponte LAN) física. 
- **Frequência de 5 GHz Exclusiva:** Desativamos completamente a banda de 2.4 GHz. Em autódromos, o espectro de 2.4 GHz é saturado por celulares, Bluetooth e rádios analógicos. Isolar a telemetria em 5 GHz nos garante um meio físico limpo e sem interferências.
- **Largura de Canal de 20 MHz:** Nós reduzimos a largura de canal de 80 MHz para 20 MHz. Nosso tráfego de dados CAN consome apenas ~240 kbps. Canais largos de 80 MHz absorvem muito mais ruído de fundo. Fixar em 20 MHz concentra toda a energia do rádio em uma banda estreita, o que aumentou drasticamente a `Relação Sinal-Ruído` e a distância de cobertura estável.

### Configuração do servidor - cliente
Para tornar a telemetria acessível a toda a equipe de dados, nós configuramos um servidor web local no box. Isso permitiu que cada engenheiro acessasse o dashboard de seu próprio dispositivo via rede Wi-Fi local de forma paralela. Para manter a estabilidade desta infraestrutura de rede, configuramos o Netplan no servidor Ubuntu para fixar o IP estático 192.168.10.1.

### Métricas de Rede
Para medir a eficácia dinâmica da nossa infraestrutura de rede de rádio durante os testes, nós monitoramos as seguintes métricas de rede em tempo real no painel admin:
- **RSSI (Força de Sinal)**.
- **Contagem de Frames (FPS):** Exibindo a taxa real de frames CAN transmitidos por segundo (com picos medidos de 1.112 fps` em pista).
- **Consumo de banda por classe do QoS:**.
- **Conexões WebSocket ativas:**.
- **Latência de ponta a ponta:**.
- **PDR (Packet Delivery Ratio) e PER (Packet Error Rate):** Para avaliar a integridade das informações.

O consumo total de largura de banda na rede é irrisório para o enlace de 5.5 GHz: a telemetria CAN consome em média **~240 kbps** rodando a 100 Hz, o que corresponde a menos de 0.1% da capacidade máxima calculada de **240.4 Mbps** (Shannon-Hartley).
// Se perguntarem

## Manufatura
Na camada de manufatura de software, nós precisávamos ter permanência, recorrência e persistência. Por conta disso, escolhemos usar serviços do sistema operacional, pois os scripts e operações que precisávamos fazer são executados a partir do momento em que nós ligamos tanto a Jetson quanto o servidor. Plug and Play.

### Funcionalidades Extras (Se tiver tempo)
Para atingirmos esses objetivos operacionais, nós integramos as seguintes tecnologias e linguagens:
- **HTTP/JWT:** Usado para autenticação stateless rápida dos engenheiros de dados no painel com validade de token de 8 horas, garantindo segurança na rede local contra conexões invasoras no box.
- **Web Worker:** Processamento em JavaScript paralelo que gerencia a decodificação dos pacotes recebidos do WebSocket e calcula buffers circulares (amostras de 3900 pontos) usando decimação LTTB para reduzir os dados para 500 pontos, mantendo a interface leve.
- **QoS HTB (Hierarchical Token Bucket):** Mecanismo de controle de tráfego de rede no servidor Linux. Configuramos três classes para isolamento de dados: a Classe 1:10 (TCP porta 8080) tem prioridade máxima absoluta para dados de sensores veiculares CAN brutos, seguida pela Classe 1:20 (WebSocket porta 8081) para o dashboard, enquanto conexões gerais como SSH e SSH Tunnels de manutenção operam na Classe 1:30 de menor prioridade.

### Kill Switch
Um dos recursos de segurança mais críticos que eu projetei e validei na manufatura de comandos foi o **botão de parada de emergência (Kill Switch)** via dashboard. Ao clicar em "KILL" na interface web, um comando é despachado via chamada POST autenticada ao backend, que imediatamente envia um byte específico pelo socket TCP de volta à Jetson. O edge agent da Jetson, ao ler esse byte de controle, monta instantaneamente um frame CAN e injeta o frame em can0 e can1 de forma simultânea. No circuito elétrico do carro, a VCU intercepta essa mensagem CAN de emergência e avisa os inversores; eles entram em estado de erro e começam a descarregar a carga dos motores.

## Validação do projeto
### Decisões tomadas com base em logs
Com os logs estruturados exportados em formato `.ld` e `.ldx` para o MoTeC i2 Pro, a equipe tomou três decisões mecânicas e dinâmicas cruciais para otimizar o carro:
1. **Decisão sobre a Largura de Canal de Rádio:** Eu decidi fixar de forma definitiva a largura do canal Wi-Fi do Box e do carro em **20 MHz** após constatar nos logs de rede que o nosso throughput consumia menos de 0.1% do canal físico (~240 kbps), e que a banda estreita nos protegia contra desvanecimento por caminhos múltiplos e interferências de outras redes no autódromo, estendendo o alcance em curvas distantes.
2. **Decisão sobre a Distribuição Dinâmica de Torque (Torque Vectoring):** Ao analisarmos os logs de rotação de motor (RPM) e torque entregue de cada corner no MoTeC durante o teste de Skid Pad, eu percebi que a roda traseira interna à curva estava girando excessivamente rápido e escorregando, indicando que o diferencial eletrônico estava aplicando torque demais em uma roda aliviada de carga vertical. Usando os canais matemáticos de Wheel Slip que configuramos, nós decidimos recalibrar a curva de atuação do Torque Vectoring na VCU. Reduzimos a rampa de torque solicitada para a roda interna quando a aceleração lateral medida pela IMU for superior a 1.2G, o que melhorou a estabilidade e reduziu o tempo de volta no Skid Pad em 0.45 segundos.

## Futuros projetos
- **IA e Simulador DIL (Driver In the Loop):** Nós desenvolvemos um simulador **DIL** utilizando a física do Assetto Corsa integrada ao nosso dashboard via pacotes UDP para treinar nossos pilotos. Para otimizar o percurso da IA em pista, nós desenvolvemos um agente inteligente autônomo baseado em **Aprendizado por Reforço Profundo** com a arquitetura **PPO (Proximal Policy Optimization)** em Python com PyTorch. O agente recebe como observação o estado atual do veículo (velocidade, ângulo de direção, yaw rate da IMU virtual), o percurso que ele passou (SLAM) e gera comandos contínuos de aceleração, frenagem e esterçamento. Desenhamos a função de recompensa para maximizar a velocidade longitudinal média enquanto penalizamos saídas de pista. O diferencial técnico é o seu **mecanismo de mapeamento em duas fases**: na primeira volta, a IA pilota o carro lentamente de forma puramente reativa e reconstrói as fronteiras internas e externas da pista em sua memória. Na segunda volta, é calculado matematicamente a **MLT (Minimum Lap Time)** ótima de menor tempo de volta resolvendo um problema de otimização de curvatura (algo que a elétrica já usa em controle) e pontos de frenagem tardia (late braking). Isso nos permitiu comparar pontos de aceleração e frenagem em comparação a pilotos humanos no simulador, assim sabemos como o piloto está indo. Mas a IA tem um problema, visando à simplificação, resolvemos deixar ela sempre no meio da pista em condições normais, a não ser se for uma curva muito fechada. Então ela não dá o percurso perfeito, mas os pontos de aceleração e frenagem.
