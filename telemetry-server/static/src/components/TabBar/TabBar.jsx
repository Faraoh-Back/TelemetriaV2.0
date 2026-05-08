import './TabBar.css'

function TabBar(props) {
    return (
        <div class="tabbar">
        {props.tabs.map(tab => (
            <div
                classList={{
                    tab: true,
                    'tab--active': tab.id === props.activeTab,
                    'tab--disabled': tab.disabled ?? false,
                }}
                onclick={() =>
                    !(tab.disabled ?? false) &&
                    tab.id !== props.activeTab &&
                    props.onSelect?.(tab.id)
                }
            >
                {tab.label}
            </div>
        ))}
        </div>
    )
}

export default TabBar
