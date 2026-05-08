import './TabBar.css'

function TabBar({ tabs, activeTab, onSelect }) {
    return (
        <div class="tabbar">
        {tabs.map(tab => {
            const isActive   = tab.id === activeTab
            const isDisabled = tab.disabled ?? false
            const cls = [
            'tab',
            isActive   ? 'tab--active'   : '',
            isDisabled ? 'tab--disabled' : '',
            ].join(' ')

            return (
            <div
                class={cls}
                onclick={() => !isDisabled && !isActive && onSelect?.(tab.id)}
            >
                {tab.label}
            </div>
            )
        })}
        </div>
    )
}

export default TabBar