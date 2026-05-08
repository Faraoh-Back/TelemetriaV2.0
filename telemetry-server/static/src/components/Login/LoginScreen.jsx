/**
 * ============================================================================
 * LoginScreen.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Renderizar a porta de entrada da aplicacao e coletar credenciais.
 *
 * Fluxo:
 *   formulario real
 *       -> valida campos obrigatorios
 *       -> chama onLogin(username, password)
 *       -> exibe erro local quando a autenticacao falha
 *
 *   modo UI
 *       -> chama onUiPreview()
 *       -> libera o dashboard sem backend para trabalho visual
 *
 * A tela nao conhece WebSocket nem dashboard. Esse controle fica no App.
 */

import { Show, createSignal } from 'solid-js'
import { getServerConfig } from '../../config/serverConfig.js'
import './LoginScreen.css'

function LoginScreen({ onLogin, onUiPreview }) {
    const [username, setUsername] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [error, setError] = createSignal('')
    const [isSubmitting, setIsSubmitting] = createSignal(false)

    const serverAddress = getServerConfig().address

    async function handleSubmit(event) {
        event.preventDefault()

        const cleanUsername = username().trim()
        if (!cleanUsername || !password()) {
            setError('Preencha usuario e senha.')
            return
        }

        setError('')
        setIsSubmitting(true)

        try {
            await onLogin?.(cleanUsername, password())
        } catch (err) {
            setError(err?.message || 'Servidor inacessivel. Verifique a rede.')
        } finally {
            setIsSubmitting(false)
        }
    }

    function handleUiPreview() {
        setError('')
        onUiPreview?.()
    }

    return (
        <main class="login-screen">
            <section class="login-shell" aria-label="Acesso ao dashboard">
                <div class="login-brand">
                    <div class="login-brand__mark">ER</div>
                    <div>
                        <span class="login-brand__eyebrow">Telemetry Control</span>
                        <h1 class="login-brand__title">E-Racing Telemetria</h1>
                    </div>
                </div>

                <div class="login-status-grid" aria-label="Estado da interface">
                    <div class="login-status">
                        <span class="login-status__label">Interface</span>
                        <strong>V2.1</strong>
                    </div>
                    <div class="login-status">
                        <span class="login-status__label">Servidor</span>
                        <strong>{serverAddress}</strong>
                    </div>
                </div>
            </section>

            <form class="login-card" onSubmit={handleSubmit}>
                <header class="login-card__header">
                    <h2 class="login-card__title">Acesso ao dashboard</h2>
                    <p class="login-card__subtitle">Sessao de telemetria em tempo real</p>
                </header>

                {/* Campos mantidos proximos ao HTML legado para preservar UX e autocomplete. */}
                <label class="login-field">
                    <span class="login-field__label">Usuario</span>
                    <input
                        class="login-field__input"
                        type="text"
                        placeholder="eracing"
                        autocomplete="username"
                        value={username()}
                        onInput={(event) => setUsername(event.currentTarget.value)}
                        disabled={isSubmitting()}
                    />
                </label>

                <label class="login-field">
                    <span class="login-field__label">Senha</span>
                    <input
                        class="login-field__input"
                        type="password"
                        placeholder="senha"
                        autocomplete="current-password"
                        value={password()}
                        onInput={(event) => setPassword(event.currentTarget.value)}
                        disabled={isSubmitting()}
                    />
                </label>

                <button
                    class="login-button"
                    type="submit"
                    disabled={isSubmitting()}
                >
                    {isSubmitting() ? 'Entrando...' : 'Entrar'}
                </button>

                <button
                    class="login-button login-button--secondary"
                    type="button"
                    disabled={isSubmitting()}
                    onClick={handleUiPreview}
                >
                    Modo UI
                </button>

                <Show when={error()}>
                    <div class="login-error" role="alert">
                        {error()}
                    </div>
                </Show>
            </form>

            <p class="login-footer">UI independente do backend disponivel para validacao visual.</p>
        </main>
    )
}

export default LoginScreen
