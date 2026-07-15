# Roteiro de rede e seguranca - quinta-feira

**Objetivo:** levantar e validar os dados de rede e seguranca que ainda nao
serao tratados no mock da Jetson.

Este documento serve para a sessao de quinta-feira, quando a equipe vai falar
com a Jetson e com as antenas.

## 1. Escopo

Nesta rodada, o foco nao e o decode CAN. O foco e:

- qualidade do enlace entre carro e base;
- estabilidade da conexao da Jetson;
- estado dos pontos de acesso / antenas;
- visibilidade de seguranca no servidor e na borda;
- coleta de prints e logs para documentacao.

## 2. O que precisa ser observado

### Na Jetson

Coletar:

- interface ativa;
- IP atual;
- rota padrao;
- status do `telemetry-edge`;
- reconexoes TCP;
- perda de pacote percebida pelo edge;
- sincronizacao de clock;
- eventos de link down/up;
- largura de banda estimada.

### Nas antenas / APs

Coletar:

- SSID / association status;
- RSSI;
- SNR;
- canal;
- largura de canal;
- taxa de modulacao;
- retries e retransmissoes;
- uptime;
- eventuais quedas DFS.

### No servidor

Coletar:

- conexoes TCP na porta 8080;
- conexoes WebSocket na porta 8081;
- latencia por frame;
- taxa de frames por segundo;
- status do TimescaleDB;
- status do SQLite;
- status do exportador de logs;
- usuarios conectados.

### Em seguranca

Coletar e validar:

- portas realmente expostas;
- autenticacao JWT;
- acesso ao dashboard;
- acesso aos downloads;
- regras de firewall;
- roteamento correto entre carro, base e servidor;
- se algum servico ficou visivel fora da rede esperada.

## 3. Ordem recomendada da coleta

### Fase 1: baseline parado

1. Ligar o servidor.
2. Ligar a Jetson.
3. Confirmar link e IP.
4. Confirmar que o dashboard abre.
5. Confirmar que nao ha erro de autenticacao.

### Fase 2: baseline de telemetria

1. Iniciar transmissao do edge.
2. Verificar latencia do primeiro frame.
3. Verificar se o frontend esta recebendo mapa CAN.
4. Confirmar se os logs de debug fazem sentido.

### Fase 3: teste com movimento

1. Rodar o carro ou simular deslocamento de link.
2. Registrar perdas, jitter e reconexoes.
3. Marcar o horario dos eventos.
4. Tirar screenshot das telas relevantes.

### Fase 4: fechamento

1. Salvar prints.
2. Salvar logs brutos.
3. Salvar configuracoes atuais.
4. Registrar o que mudou em relacao ao baseline.

## 4. Comandos uteis para a sessao

Os comandos abaixo sao exemplos de coleta. Ajustar para o ambiente real:

```bash
ip a
ip route
ss -tulpn
journalctl -u telemetry-server --since "30 min ago"
journalctl -u telemetry-edge --since "30 min ago"
```

Para o link sem fio:

```bash
iw dev wlan0 link
iw dev wlan0 station dump
```

Para verificar o tráfego do servidor:

```bash
tc -s qdisc show dev <iface>
tc -s class show dev <iface>
```

Para confirmar portas do stack atual:

- `8080` para ingestao TCP;
- `8081` para HTTP/WebSocket;
- `9999` para NTP interno do backend;
- `5432` para Postgres/TimescaleDB, se aplicavel no host.

## 5. O que separar no relatorio

Separar em tres blocos:

1. conectividade;
2. desempenho;
3. seguranca.

### Conectividade

- link sobrou ou caiu;
- a Jetson perdeu rota;
- o edge reconectou sozinho;
- o dashboard deixou de atualizar.

### Desempenho

- latencia dos frames;
- taxa de frames;
- perda ou atraso em burst;
- efeito de distancia ou obstrucao.

### Seguranca

- acesso indevido;
- porta exposta sem necessidade;
- token invalido aceito ou rejeitado corretamente;
- firewall nao esperado.

## 6. O que nao deve ser alterado antes da sessao

Nao mudar antes de coletar baseline:

- credenciais;
- topologia;
- roteamento;
- firmware das antenas;
- regras de firewall;
- parametros do edge;
- configuracao do servidor que afete o fluxo atual.

## 7. Entregaveis esperados

A sessao de quinta deve terminar com:

- capturas de tela do estado da rede;
- capturas do dashboard e do admin;
- lista de metricas observadas;
- anomalias encontradas;
- decisoes para a proxima iteracao.

Se alguma metrica nao puder ser coletada no momento, registrar o bloqueio e o
motivo. Nao inventar numero no relatorio.
