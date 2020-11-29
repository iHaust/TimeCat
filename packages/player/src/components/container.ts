import { disableScrolling, nodeStore, debounce } from '@timecat/utils'
import HTML from '../ui.html'
import CSS from '../ui.scss'
import { createIframeDOM, injectIframeContent } from '../dom'
import smoothScroll from 'smoothscroll-polyfill'
import { ReplayInternalOptions, VNode, InfoData } from '@timecat/share'
import { observer } from '../utils'
import { PlayerEventTypes } from '../types'
import { Panel } from './panel'
import { PageStartComponent } from './page-start'

export class ContainerComponent {
    container: HTMLElement
    sandBox: HTMLIFrameElement
    sandBoxDoc: Document
    resize: (options?: Partial<{ setWidth: number; setHeight: number; maxScale: number }>) => void
    options: ReplayInternalOptions
    target: Element | Window

    constructor(options: ReplayInternalOptions) {
        this.options = options
        this.init()
    }

    init() {
        const target = this.options.target
        const targetElement = typeof target === 'string' ? document.querySelector(target) : target
        this.target = targetElement as HTMLElement
        this.initTemplate()
        this.initSandbox()
        const { resize } = this.makeItResponsive()
        this.resize = resize
        this.initPanel()
    }

    initPanel() {
        new Panel(this)
        new PageStartComponent()
    }

    initSandbox() {
        this.sandBox = this.container.querySelector('.player-sandbox') as HTMLIFrameElement
        this.sandBoxDoc = this.sandBox.contentDocument!
        this.setSmoothScroll(this.sandBox.contentWindow!)
        createIframeDOM(this.sandBoxDoc, this.getSnapshotRecord())
        disableScrolling(this.sandBox.contentWindow!.document)
        this.setViewState()
    }

    getSnapshotRecord() {
        return window.G_REPLAY_DATA.snapshot.data as {
            vNode: VNode
        } & InfoData
    }

    // use scroll polyfill if browser (e.g. ios safari) not support
    setSmoothScroll(context: Window) {
        smoothScroll.polyfill()
        context.HTMLElement.prototype.scroll = window.scroll
        context.HTMLElement.prototype.scrollTo = window.scrollTo
    }

    setViewState() {
        nodeStore.reset()
        injectIframeContent(this.sandBoxDoc, this.getSnapshotRecord())
    }

    initTemplate() {
        let targetElement: HTMLElement =
            this.target instanceof Window ? (this.target as Window).document.body : (this.target as HTMLElement)

        if (targetElement.tagName === 'BODY') {
            const shadowHost = document.createElement('div')
            shadowHost.className = 'player-shadowhost'
            targetElement.appendChild(shadowHost)
            targetElement = shadowHost
        }

        const shadow = targetElement.attachShadow({ mode: 'open' })
        shadow.appendChild(this.createStyle('player-css', CSS))
        shadow.appendChild(this.createContainer('player-main', HTML))
    }

    createContainer(className: string, html: string) {
        const parser = new DOMParser()
        const el = parser.parseFromString(html, 'text/html').body.firstChild as HTMLElement
        el.className = className
        el.style.width = this.getSnapshotRecord().width + 'px'
        el.style.height = this.getSnapshotRecord().height + 'px'
        el.style.display = 'none'
        return (this.container = el)
    }

    makeItResponsive() {
        const self = this
        const debounceResizeFn = debounce(resizeHandle, 500)

        const callbackFn = () => debounceResizeFn({ target: self.target as EventTarget } as Event)
        window.addEventListener('resize', callbackFn, true)

        this.options.destroyStore.add(() => window.removeEventListener('resize', callbackFn, true))

        setTimeout(() => (this.container.style.opacity = '1'))
        this.container.style.display = 'block'

        let setMaxScale: number

        triggerResize()

        function triggerResize(options?: Partial<{ setWidth: number; setHeight: number; maxScale: number }>) {
            const { setHeight, setWidth, maxScale } = options || {}
            resizeHandle(({ target: self.target } as unknown) as Event, setWidth, setHeight, maxScale)
        }

        async function resizeHandle(e?: Event, setWidth?: number, setHeight?: number, maxScale?: number) {
            if (!e) {
                return
            }

            if (maxScale) {
                setMaxScale = maxScale
            }

            if (e.target instanceof Window) {
                const { innerWidth: w, innerHeight: h } = e.target
                scalePages(self.container, w, h, setWidth, setHeight)
            } else {
                const { offsetWidth: w, offsetHeight: h } = e.target as HTMLElement
                scalePages(self.container, w, h, setWidth, setHeight)
            }

            observer.emit(PlayerEventTypes.RESIZE)
        }

        function scalePages(
            target: HTMLElement,
            maxWidth: number,
            maxHeight: number,
            setWidth?: number,
            setHeight?: number
        ) {
            const { mode: replayMode } = window.G_REPLAY_OPTIONS || {}

            const panelHeight = replayMode === 'live' ? 0 : 40 - 2 // subtract the gap

            const { width: targetWidth, height: targetHeight } = getPageSize(target)

            const scaleX = maxWidth / (setWidth || targetWidth)
            const scaleY = maxHeight / ((setHeight || targetHeight) + panelHeight)

            // limit scale
            const scale = Math.min(scaleX > scaleY ? scaleY : scaleX, setMaxScale || 1)

            const left =
                ((setWidth || targetWidth) * scale - (setWidth || targetWidth)) / 2 +
                (maxWidth - (setWidth || targetWidth) * scale) / 2

            const top = (maxHeight - (setHeight || targetHeight) - panelHeight * scale) / 2

            target.style.transform = `scale(${scale})`
            target.style.left = left + 'px'
            target.style.top = top + 'px'

            if (setWidth) {
                target.style.width = setWidth + 'px'
            }
            if (setHeight) {
                target.style.height = setHeight + 'px'
            }
        }

        function getPageSize(target: HTMLElement) {
            return {
                width: parseInt(target.style.width, 10),
                height: parseInt(target.style.height, 10)
            }
        }

        return {
            resize: triggerResize
        }
    }

    createStyle(id: string, s: string) {
        const style = document.createElement('style')
        style.id = id
        style.innerHTML = s
        return style
    }
}