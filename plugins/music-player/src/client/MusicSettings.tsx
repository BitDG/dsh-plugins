import type { MusicSnapshot } from './controller.ts'
import { styles } from './styles.ts'

export function MusicSettings({ useMusic }: { useMusic: <T>(selector: (state: MusicSnapshot) => T) => T }) {
  const state = useMusic(value => value)
  return <section className="dmp-generator" style={{ position: 'relative', inset: 'auto', height: '100%', boxSizing: 'border-box' }}><style>{styles}</style><div className="dmp-generator-inner"><h2>音乐插件</h2><p>兼容 MusicFree 最小协议。插件在短生命周期子进程中运行，使用精确网络白名单、私网 DNS 拒绝、响应大小限制和硬超时。</p><div className="dmp-review">{state.plugins.map(plugin => <div className="dmp-check-row" key={plugin.id}><span>♪</span><span><strong>{plugin.platform}</strong><br />{plugin.version} · {plugin.author} · {plugin.allowedHosts.join(', ')}</span></div>)}</div></div></section>
}
