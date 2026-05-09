import { Show } from 'solid-js'
import { TEAM_LOGO_ALT, TEAM_LOGO_SRC } from '../../config/brandConfig.js'
import './BrandLogo.css'

function BrandLogo({ className = 'brand-logo' }) {
    return (
        <Show
            when={TEAM_LOGO_SRC}
            fallback={<span class={className} aria-label={TEAM_LOGO_ALT}>E</span>}
        >
            <img class={className} src={TEAM_LOGO_SRC} alt={TEAM_LOGO_ALT} />
        </Show>
    )
}

export default BrandLogo
