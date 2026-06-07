import { createSignal, Show } from 'solid-js'
import './EmergencyButton.css'

/**
 * EmergencyButton — Botão de parada de emergência do veículo.
 *
 * Envia o comando CAN 0x67 (kill) para o backend.
 * Exibe um modal de confirmação com dupla etapa para evitar acionamento acidental.
 *
 * Props:
 *   onEmergencyStop: () => Promise  — callback que dispara o POST
 *   disabled: boolean               — desabilita o botão (ex: sem conexão)
 */
function EmergencyButton(props) {
    const [isModalOpen, setIsModalOpen] = createSignal(false)
    const [isPending, setIsPending] = createSignal(false)
    const [feedbackMessage, setFeedbackMessage] = createSignal('')
    const [feedbackType, setFeedbackType,] = createSignal('') // 'success' | 'error'
    const [isKilled, setIsKilled] = createSignal(false)

    function openModal() {
        if (props.disabled || isPending()) return
        setFeedbackMessage('')
        setFeedbackType('')
        setIsModalOpen(true)
    }

    function closeModal() {
        if (isPending()) return
        setIsModalOpen(false)
        setFeedbackMessage('')
        setFeedbackType('')
    }

    async function confirmEmergencyStop() {
        if (isPending()) return
        setIsPending(true)
        setFeedbackMessage('')
        setFeedbackType('')

        try {
            if (isKilled()) {
                await props.onEmergencyResume?.()
                setIsKilled(false)
                setFeedbackMessage('Veículo religado com sucesso.')
            } else {
                await props.onEmergencyStop?.()
                setIsKilled(true)
                setFeedbackMessage('Comando de emergência enviado com sucesso.')
            }
            setFeedbackType('success')
            setTimeout(() => {
                setIsModalOpen(false)
                setFeedbackMessage('')
                setFeedbackType('')
            }, 2000)
        } catch (error) {
            setFeedbackMessage(error.message || 'Falha ao enviar comando.')
            setFeedbackType('error')
        } finally {
            setIsPending(false)
        }
    }
    return (
        <>
            {/* Botão na TopBar */}
            <button
                id="emergency-stop-btn"
                class={`emergency-btn ${isKilled() ? 'emergency-btn--killed' : ''}`}
                type="button"
                title={isKilled() ? 'Religar veículo' : 'Parada de emergência'}
                disabled={props.disabled}
                onClick={openModal}
            >
                {isKilled() ? 'RESUME' : 'KILL'}
            </button>

            {/* Modal de confirmação */}
            <Show when={isModalOpen()}>
                <div
                    class="modal-backdrop"
                    role="presentation"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isPending()) closeModal()
                    }}
                >
                    <div
                        class="telemetry-stop-modal"
                        role="dialog"
                        aria-modal="true"
                    >
                        <h2>{isKilled() ? 'Religar Veículo' : 'Parada de Emergência'}</h2>

                        <p style={{ "margin-bottom": "12px" }}>
                            {isKilled()
                                ? 'Confirmar o religamento do veículo? Isso enviará o comando 0x67 com payload 0x01.'
                                : 'Você tem certeza? Isso enviará o comando de desligamento imediato (0x67) para o veículo.'
                            }
                        </p>

                        <Show when={feedbackMessage()}>
                            <p
                                style={{
                                    'margin-bottom': '12px',
                                    'color': feedbackType() === 'success' ? 'var(--ok)' : 'var(--red)',
                                }}
                            >
                                {feedbackMessage()}
                            </p>
                        </Show>

                        <div class="telemetry-stop-modal__actions">
                            <button
                                class="modal-button"
                                type="button"
                                disabled={isPending()}
                                onClick={closeModal}
                            >
                                Cancelar
                            </button>
                            <button
                                id="emergency-stop-confirm"
                                class="modal-button modal-button--danger"
                                type="button"
                                disabled={isPending()}
                                onClick={confirmEmergencyStop}
                            >
                                {isPending() ? 'Enviando...' : isKilled() ? 'Religar' : 'Confirmar Kill'}
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </>
    )
}

export default EmergencyButton
