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
    const [feedbackType, setFeedbackType] = createSignal('') // 'success' | 'error'

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
            await props.onEmergencyStop?.()
            setFeedbackMessage('Comando de emergência enviado com sucesso.')
            setFeedbackType('success')
            // Fecha o modal após 2s de feedback positivo
            setTimeout(() => {
                setIsModalOpen(false)
                setFeedbackMessage('')
                setFeedbackType('')
            }, 2000)
        } catch (error) {
            setFeedbackMessage(error.message || 'Falha ao enviar comando de emergência.')
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
                class="emergency-btn"
                type="button"
                title="Parada de emergência"
                disabled={props.disabled}
                onClick={openModal}
            >
                KILL
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
                        <h2>Parada de Emergência</h2>
                        
                        <p style={{ "margin-bottom": "12px" }}>
                            Você tem certeza? Isso enviará o comando de <strong>desligamento imediato</strong> (0x67) para o veículo.
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
                                {isPending() ? 'Enviando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </>
    )
}

export default EmergencyButton
