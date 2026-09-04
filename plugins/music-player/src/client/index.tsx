import type { Context } from '@deepseek-ai/cordis'
import { useState, type ComponentProps } from 'react'
import { MusicController } from './controller.ts'
import { MusicOverlay } from './MusicOverlay.tsx'
import { MusicSettings } from './MusicSettings.tsx'
import { MusicSidebar } from './MusicSidebar.tsx'

type SessionInput = { setDraft(value: string): void; submit(mode?: 'queue' | 'steer'): void }
type ConversationService = { input: { for(ctx: Context): SessionInput } }
type ClientContext = Context & {
  slots: { inject(name: string, callback: () => unknown): unknown; register(options: Record<string, unknown>, component: unknown): () => void }
  sessions: { list: { getSnapshot(): { current?: string } }; binding(id: string): { ctx: Context } | undefined }
  get(name: string): unknown
}

export const name = 'music-player.client'
export const inject = ['slots', 'sessions', 'conversation']

export function apply(context: Context): void {
  const ctx = context as ClientContext
  const controller = new MusicController((prompt) => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) throw new Error('请先打开一个对话，再启动 AI 音源生成。')
    const binding = ctx.sessions.binding(current); const conversation = ctx.get('conversation') as ConversationService | undefined
    if (binding === undefined || conversation === undefined) throw new Error('当前对话尚未准备好。')
    const input = conversation.input.for(binding.ctx); input.setDraft(prompt); input.submit()
  })
  ctx.effect(() => () => { controller.dispose() }, 'music-player: client controller')
  let openGenerator: (() => void) | undefined
  const injected = () => ({
    hooks: { music: controller.store }, activate: (width: number) => { controller.activate(width) }, deactivate: () => { controller.deactivate() },
    selectPlugin: (id: string) => { controller.selectPlugin(id) }, setQuery: (query: string) => { controller.setQuery(query) },
    search: () => controller.search(), play: (item: Parameters<MusicController['play']>[0]) => controller.play(item),
    attachAudio: controller.attachAudio, resumePlayback: controller.resumePlayback, togglePlayback: controller.togglePlayback, seekPlayback: controller.seekPlayback,
    generate: (input: Parameters<MusicController['generate']>[0]) => controller.generate(input), install: (id: string) => controller.install(id),
    openGenerator: () => { openGenerator?.() },
  })
  ctx.slots.inject('sidebar.music', () => ctx.slots.register({ name: 'sidebar.music', inject: injected }, MusicSidebar))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'music-player', order: 11, inject: () => ({ ...injected(), openGenerator: () => { openGenerator?.() } }) }, function MusicOverlaySeat(props: Record<string, unknown>) {
    const [generatorOpen, setGeneratorOpen] = useState(false); openGenerator = () => { setGeneratorOpen(true) }
    const overlayProps = props as unknown as Omit<ComponentProps<typeof MusicOverlay>, 'generatorOpen' | 'closeGenerator'>
    return <MusicOverlay {...overlayProps} generatorOpen={generatorOpen} closeGenerator={() => { setGeneratorOpen(false) }} />
  }))
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'music-player', order: 36, label: '音乐插件', inject: injected }, MusicSettings))
}
