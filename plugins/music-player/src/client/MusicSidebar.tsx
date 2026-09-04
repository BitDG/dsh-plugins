import { useEffect, type FormEvent } from 'react'
import type { MusicItem } from '../types.ts'
import type { MusicSnapshot } from './controller.ts'
import { styles } from './styles.ts'

interface Props {
  sidebarWidth: number
  useMusic: <T>(selector: (state: MusicSnapshot) => T) => T
  activate: (width: number) => void
  deactivate: () => void
  selectPlugin: (id: string) => void
  setQuery: (query: string) => void
  search: () => Promise<void>
  play: (item: MusicItem) => Promise<void>
  togglePlayback: () => void
  seekPlayback: (seconds: number) => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

function formatPublished(item: MusicItem): string {
  if (item.publishedLabel !== undefined) return item.publishedLabel
  if (item.publishedAt === undefined) return '时间未知'
  const date = new Date(item.publishedAt)
  return Number.isFinite(date.valueOf()) ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '时间未知'
}

export function MusicSidebar({ sidebarWidth, useMusic, activate, deactivate, selectPlugin, setQuery, search, play, togglePlayback, seekPlayback }: Props) {
  const state = useMusic(value => value)
  const currentIndex = state.current === null ? -1 : state.results.findIndex(item => item.id === state.current!.id && item.platform === state.current!.platform)
  useEffect(() => { activate(sidebarWidth); return deactivate }, [activate, deactivate, sidebarWidth])
  const submitSearch = (event: FormEvent) => { event.preventDefault(); void search() }
  return <section className="dmp-sidebar" aria-label="音乐">
    <style>{styles}</style>
    <label className="dmp-source-select"><span>音乐来源</span><select aria-label="选择音乐平台" value={state.selectedPluginId} onChange={event => { selectPlugin(event.target.value) }} disabled={state.plugins.length === 0}>
      {state.plugins.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.platform}</option>)}
    </select></label>
    <form className="dmp-sidebar-search" onSubmit={submitSearch}>
      <input className="dmp-input" aria-label="搜索音乐" value={state.query} onChange={event => { setQuery(event.target.value) }} placeholder="搜索音乐" />
      <button className="dmp-search-button" type="submit" disabled={state.loading || state.query.trim() === ''} aria-label="搜索">⌕</button>
    </form>
    {state.error !== null && <div className="dmp-sidebar-message dmp-error">{state.error}</div>}
    {state.notice !== null && <div className="dmp-sidebar-message dmp-notice">{state.notice}</div>}
    <div className="dmp-sidebar-results" aria-label="搜索结果" aria-live="polite">
      {state.loading && state.results.length === 0 ? <div className="dmp-empty">正在搜索…</div> : state.results.length === 0 ? <div className="dmp-empty">输入歌名、歌手或关键词，在当前音源中搜索。</div> : state.results.map(item => <button key={`${item.platform}:${item.id}`} type="button" className="dmp-track" data-on={state.current?.id === item.id} onClick={() => { void play(item) }}>
        {item.artwork === undefined ? <span className="dmp-cover" aria-hidden="true">♪</span> : <img className="dmp-cover" src={item.artwork} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <span className="dmp-track-copy"><span className="dmp-title">{item.title}</span><span className="dmp-artist">{item.artist} · {formatPublished(item)}</span></span>
        <span className="dmp-play-mark" aria-hidden="true">{state.current?.id === item.id ? '◆' : '▶'}</span>
      </button>)}
    </div>
    <div className="dmp-mini-player" data-empty={state.current === null}>
      <button type="button" className="dmp-play-toggle" onClick={togglePlayback} disabled={state.source === null} aria-label={state.playing ? '暂停' : '播放'}>{state.playing ? 'Ⅱ' : '▶'}</button>
      <div className="dmp-now"><strong>{state.current?.title ?? '尚未播放'}</strong><small>{state.current?.artist ?? '选择一首公开音频'}</small></div>
      <span className="dmp-time">{currentIndex < 0 ? formatTime(state.currentTime) : `${String(currentIndex + 1)}/${String(state.results.length)}`}</span>
      <input className="dmp-progress" type="range" min="0" max={Math.max(state.duration, 1)} step="1" value={Math.min(state.currentTime, Math.max(state.duration, 1))} onChange={event => { seekPlayback(Number(event.target.value)) }} disabled={state.source === null} aria-label="播放进度" />
    </div>
  </section>
}
