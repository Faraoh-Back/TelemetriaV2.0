/**
 * Estado vazio da area de analise.
 *
 * Aparece quando a sessao ainda nao recebeu sinais. Ele orienta visualmente o
 * operador sem assumir que existe backend, carro ou stream conectado.
 */

function DashboardEmptyState({ mode }) {
    const isUiMode = mode === 'ui'

    return (
        <section class="dashboard-empty" aria-label="Estado da telemetria">
            <div class="dashboard-empty__main">
                <span class="dashboard-empty__eyebrow">
                    {isUiMode ? 'Preview de interface' : 'Aguardando stream'}
                </span>
                <h2 class="dashboard-empty__title">
                    Nenhum sinal recebido nesta sessao
                </h2>
                <p class="dashboard-empty__copy">
                    Os cards, seletor e graficos entram em operacao assim que os
                    primeiros pacotes forem processados. Enquanto isso, a tela
                    preserva a estrutura real do cockpit de telemetria.
                </p>
            </div>

            <div class="dashboard-empty__checks">
                <div class="dashboard-empty__check">
                    <span class="dashboard-empty__dot dashboard-empty__dot--ready" />
                    Interface carregada
                </div>
                <div class="dashboard-empty__check">
                    <span class="dashboard-empty__dot" />
                    Decoder aguardando sinais
                </div>
                <div class="dashboard-empty__check">
                    <span class="dashboard-empty__dot" />
                    Graficos sem buffer
                </div>
            </div>
        </section>
    )
}

export default DashboardEmptyState
