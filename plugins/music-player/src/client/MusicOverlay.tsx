import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { MusicSnapshot } from './controller.ts'
import { styles } from './styles.ts'

interface Props {
  useMusic: <T>(selector: (state: MusicSnapshot) => T) => T
  generate: (input: { sourceUrl: string; query: string; author: string; authorized: boolean }) => Promise<void>
  install: (reviewId: string) => Promise<void>
  attachAudio: (audio: HTMLAudioElement | null) => void
  resumePlayback: () => void
  generatorOpen: boolean
  closeGenerator: () => void
}

export function MusicOverlay({ useMusic, generate, install, attachAudio, resumePlayback, generatorOpen, closeGenerator }: Props) {
  const state = useMusic(value => value); const audio = useRef<HTMLAudioElement>(null)
  const [sourceUrl, setSourceUrl] = useState('https://archive.org/details/netlabels')
  const [author, setAuthor] = useState('DSHP user'); const [generationQuery, setGenerationQuery] = useState('ambient'); const [authorized, setAuthorized] = useState(false)
  useEffect(() => { attachAudio(audio.current); return () => { attachAudio(null) } }, [attachAudio])
  useEffect(() => { if (state.source !== null) resumePlayback() }, [resumePlayback, state.source])
  const overlayStyle = { '--dmp-sidebar-width': `${String(state.sidebarWidth)}px` } as CSSProperties
  const submitGeneration = (event: FormEvent) => { event.preventDefault(); void generate({ sourceUrl, query: generationQuery, author, authorized }) }
  return <><style>{styles}</style><audio ref={audio} className="dmp-audio-host" preload="metadata" src={state.source?.url} aria-label={state.current === null ? '音乐播放器' : `正在播放 ${state.current.title}`} />
    {generatorOpen && <section className="dmp-generator-overlay" style={overlayStyle} aria-label="AI 音源生成"><div className="dmp-generator-inner"><button type="button" className="dmp-button dmp-button-secondary" onClick={closeGenerator}>返回音乐</button><h2>让 AI 生成音源插件</h2><p>一键创建隔离任务，并把严格的 MusicFree 协议提示提交到当前对话。AI 产物先经过静态策略和隔离运行器审阅；只有你明确确认后才会安装。</p>
      <form className="dmp-form" onSubmit={submitGeneration}><label>音源页面或公开 API<input className="dmp-input" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value) }} /></label><label>验收搜索词<input className="dmp-input" value={generationQuery} onChange={event => { setGenerationQuery(event.target.value) }} /></label><label>插件作者<input className="dmp-input" value={author} onChange={event => { setAuthor(event.target.value) }} /></label><label className="dmp-check"><input type="checkbox" checked={authorized} onChange={event => { setAuthorized(event.target.checked) }} /><span>我确认有权适配此公开来源；不绕过登录、付费、DRM、签名或反爬控制。</span></label><button className="dmp-button" type="submit" disabled={!authorized || state.loading}>一键启动 AI 生成</button></form>
      {state.generation !== null && <div className="dmp-review"><h3>生成任务：{state.generation.status}</h3><div className="dmp-path">{state.generation.outputPath}</div>{state.generation.review?.checks.map(check => <div className="dmp-check-row" key={check.name}><span>{check.ok ? '✓' : '×'}</span><span><strong>{check.name}</strong><br />{check.detail}</span></div>)}{state.generation.review?.accepted === true && <button className="dmp-button" type="button" onClick={() => { void install(state.generation!.review!.id) }}>确认安装已审阅插件</button>}{state.generation.error !== undefined && <div className="dmp-error">{state.generation.error}</div>}</div>}
    </div></section>}
  </>
}
