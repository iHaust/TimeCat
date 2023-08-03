/**
 * Copyright (c) oct16.
 * https://github.com/oct16
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { watchers, baseWatchers } from './watchers'
import { AudioWatcher } from './audio'
import { MarkSnapRecord, RecordData, RecordType, TerminateRecord } from '@timecat/share'
import {
  logError,
  nodeStore,
  getTime,
  tempEmptyFn,
  tempEmptyPromise,
  tempPromise,
  IDB,
  delay,
  MARK_SNAP_RECORDS,
  READ_LIMIT_TIME,
  DEFAULT_DB_NAME,
  idb
} from '@timecat/utils'
import { Snapshot } from './snapshot'
import { getHeadData } from './head'
import { LocationWatcher } from './watchers/location'
import { Pluginable } from './pluginable'
import { Watcher } from './watcher'
import { VideoWatcher } from './watchers/video'
import { RecorderMiddleware, RecorderStatus, RecordInternalOptions, RecordOptions } from './types'

export class Recorder {
  public startTime: number
  public destroyTime: number
  public status: RecorderStatus = RecorderStatus.PAUSE
  public onData: RecorderModule['onData'] = tempEmptyFn
  public destroy: RecorderModule['destroy'] = tempEmptyPromise
  public pause: RecorderModule['pause'] = tempEmptyPromise as RecorderModule['pause']
  public record: RecorderModule['record'] = tempEmptyPromise as RecorderModule['record']
  public use: RecorderModule['use'] = tempEmptyFn
  public clearDB: RecorderModule['clearDB'] = tempEmptyPromise
  public readDB: RecorderModule['readDB'] = tempPromise
  public getMarkRecord: RecorderModule['getMarkRecord'] = tempPromise
  constructor(options?: RecordOptions) {
    const recorder = new RecorderModule(options)
    Object.keys(this).forEach((key: keyof Recorder) => {
      Object.defineProperty(this, key, {
        get() {
          return typeof recorder[key] === 'function' ? (recorder[key] as Function).bind(recorder) : recorder[key]
        }
      })
    })
  }
}

export class RecorderModule extends Pluginable {
  private static defaultRecordOpts = {
    storeKey: DEFAULT_DB_NAME,
    mode: 'default',
    write: true,
    keep: false,
    audio: false,
    video: false,
    emitLocationImmediate: true,
    context: window,
    rewriteResource: [],
    disableWatchers: [],
    writeKeepTime: READ_LIMIT_TIME
  } as RecordOptions
  private defaultMiddleware: RecorderMiddleware[] = []
  private destroyStore: Set<Function> = new Set()
  private listenStore: Set<Function> = new Set()
  private middleware: RecorderMiddleware[] = [...this.defaultMiddleware]
  private watchers: Array<typeof Watcher>
  private watchersInstance = new Map<string, Watcher<RecordData>>()
  private watchesReadyPromise = new Promise(resolve => (this.watcherResolve = resolve))
  private watcherResolve: Function
  private startTime: number
  private destroyTime: number
  // 页面定时快照数据，最多存储2个，使用时取第0位，第1位是替补
  private markSnapRecords: MarkSnapRecord[] = []

  public status: RecorderStatus = RecorderStatus.PAUSE
  public db: IDB
  public options: RecordInternalOptions

  constructor(options?: RecordOptions) {
    super(options)
    const opts = this.initOptions(options)
    opts.rootContext = opts.rootContext || opts.context
    this.options = opts

    try {
      this.markSnapRecords = opts.keep ? JSON.parse(localStorage.getItem(MARK_SNAP_RECORDS) || '[]') : []
    } catch (err) {
      this.markSnapRecords = []
    }

    this.watchers = this.getWatchers() as typeof Watcher[]
    this.init()
  }

  private initOptions(options?: RecordOptions) {
    const opts = { ...RecorderModule.defaultRecordOpts, ...options } as RecordInternalOptions
    if (opts.video === true) {
      opts.video = { fps: 24 }
    } else if (opts.video && 'fps' in opts.video) {
      if (opts.video.fps > 24) {
        opts.video.fps = 24
      }
    }
    return opts
  }

  private init() {
    this.startTime = getTime()
    const options = this.options
    this.db = idb(options.storeKey)
    this.loadPlugins()
    this.hooks.beforeRun.call(this)
    this.record(options)
    this.hooks.run.call(this)
    this.intervalDelDB()
  }

  public onData(fn: (data: RecordData, next: () => Promise<void>) => Promise<void>) {
    this.middleware.unshift(fn)
  }

  public async destroy() {
    if (this.status === RecorderStatus.HALT) {
      return
    }
    const ret = await this.pause()
    if (ret) {
      this.status = RecorderStatus.HALT
      this.destroyTime = ret.lastTime || getTime()
    }
  }

  private async pause() {
    if (this.status === RecorderStatus.RUNNING) {
      this.status = RecorderStatus.PAUSE
      const last = await this.db.last().catch(() => {})

      await this.cancelListener()
      this.destroyStore.forEach(un => un())
      this.destroyStore.clear()

      let lastTime: number | null = null
      if (last) {
        lastTime = last.time + 1
        const data = {
          type: RecordType.TERMINATE,
          data: null,
          relatedId: window.G_RECORD_RELATED_ID,
          time: lastTime
        }

        if (data.relatedId) {
          if (this.options.write) {
            this.db.add(data as TerminateRecord)
          }
          this.connectCompose(this.middleware)(data as RecordData)
        }
      }
      return { lastTime }
    }
  }

  public clearDB() {
    this.db.clear()
  }

  public async readDB() {
    const records = await this.db.readAll()
    let result: any = []
    const markRecord = this.markSnapRecords[0]

    records?.forEach((record: RecordData) => {
      if (this.options.writeKeepTime > 0 && (markRecord?.id || 0) > (record.id || 0)) {
        return false
      }
      result.push(record)
    })

    // 还原快照 for dom/canvas
    if (this.options.writeKeepTime > 0 && result[0] && result[0]?.type !== RecordType.HEAD) {
      result = [...markRecord.snapCanvasRecords, ...result]
      result = [markRecord.snapDomRecord, ...result]
    }

    return result
  }

  public async getMarkRecord() {
    return await this.db.getMarkRecord({
      limit: this.options.writeKeepTime
    })
  }

  private async cancelListener() {
    // wait for watchers loaded
    await this.watchesReadyPromise
    this.listenStore.forEach(un => un())
    this.listenStore.clear()
    nodeStore.reset()
  }

  private getWatchers() {
    const { video, audio, disableWatchers } = this.options
    const watchersList = [Snapshot, ...Object.values(watchers)] as typeof Watcher[]
    if (audio) {
      watchersList.push(AudioWatcher as typeof Watcher)
    }
    if (video) {
      watchersList.push(VideoWatcher as typeof Watcher)
    }

    return watchersList.filter(watcher => {
      return !~disableWatchers.indexOf(watcher.name as keyof typeof watchers)
    })
  }

  private record(options: RecordOptions | RecordInternalOptions): void {
    if (this.status === RecorderStatus.PAUSE) {
      const opts = { ...RecorderModule.defaultRecordOpts, ...options } as RecordInternalOptions
      this.startRecord((opts.context.G_RECORD_OPTIONS = opts))
      return
    }
  }

  private async startRecord(options: RecordInternalOptions) {
    this.status = RecorderStatus.RUNNING
    let activeWatchers = [...this.watchers, ...this.pluginWatchers]

    const isSameCtx = options.context === this.options.rootContext
    if (isSameCtx) {
      if (!options.keep) {
        this.db.clear()
      }
    } else {
      // for iframe watchers
      activeWatchers = [Snapshot, ...Object.values(baseWatchers)] as typeof Watcher[]
    }

    const onEmit = (options: RecordOptions) => {
      const { write } = options
      const emitTasks: Array<RecordData> = []
      const { middleware: rootMiddleware } = this.options.rootRecorder || { middleware: [] }
      const execTasksChain = (() => {
        let concurrency = 0
        const MAX_CONCURRENCY = 1
        return async () => {
          if (concurrency >= MAX_CONCURRENCY) {
            return
          }
          concurrency++
          while (emitTasks.length) {
            const record = emitTasks.shift()!
            await delay(0)
            if (this.status === RecorderStatus.RUNNING) {
              if (write) {
                this.db.add(record)
              }
              const middleware = [...rootMiddleware, ...this.middleware]
              await this.connectCompose(middleware)(record)
              this.hooks.emit.call(record)
            }
          }
          concurrency--
        }
      })()

      return (data: RecordData) => {
        if (!data) {
          return
        }

        let needMarkSnap = false
        if (this.markSnapRecords.length === 0) {
          needMarkSnap = true
        } else {
          const lastMarkSnapRecord = this.markSnapRecords[this.markSnapRecords.length - 1]
          if (getTime() - lastMarkSnapRecord.time > this.options.writeKeepTime) {
            needMarkSnap = true
          }
        }

        if (needMarkSnap) {
          const record = {
            type: data.type,
            time: data.time,
            id: data.id,
            relatedId: data.relatedId,
            snapDomRecord: Snapshot.GetSnapDomForRecord(window, data),
            snapCanvasRecords: Snapshot.GetSnapCanvasForRecords(document.getElementsByTagName('canvas'), data),
            data: null
          } as MarkSnapRecord
          this.markSnapRecords.push(record)
          this.options.keep && localStorage.setItem(MARK_SNAP_RECORDS, JSON.stringify(this.markSnapRecords))

          data.callbackFn = (dbRecord: RecordData) => {
            this.markSnapRecords.forEach(item => {
              if (item.type === dbRecord.type && item.time === dbRecord.time) {
                item.id = dbRecord.id
                this.options.keep && localStorage.setItem(MARK_SNAP_RECORDS, JSON.stringify(this.markSnapRecords))
              }
            })
          }
        }

        if (this.markSnapRecords.length > 2) {
          this.markSnapRecords.splice(0, 1)
          this.options.keep && localStorage.setItem(MARK_SNAP_RECORDS, JSON.stringify(this.markSnapRecords))
        }

        emitTasks.push(data)
        execTasksChain()
      }
    }

    const isInRoot = options.context === this.options.rootContext
    const emit = onEmit(options)
    const headData = getHeadData()
    const relatedId = isInRoot ? headData.relatedId : options.rootContext.G_RECORD_RELATED_ID

    options.context.G_RECORD_RELATED_ID = relatedId

    if (isInRoot) {
      emit({
        type: RecordType.HEAD,
        data: headData,
        relatedId,
        time: getTime()
      })
    }

    activeWatchers.forEach(Watcher => {
      try {
        const watcher = new Watcher({
          recorder: this,
          context: options && options.context,
          listenStore: this.listenStore,
          relatedId,
          emit,
          watchers: this.watchersInstance
        })
        this.watchersInstance.set(Watcher.name, watcher)
      } catch (e) {
        logError(e)
      }
    })

    if (isInRoot && options.emitLocationImmediate) {
      const locationInstance = this.watchersInstance.get(LocationWatcher.name) as InstanceType<typeof LocationWatcher>
      locationInstance?.emitOne()
    }

    this.watcherResolve()
    await this.recordSubIFrames(options.context)
  }

  private async waitingSubIFramesLoaded(context: Window) {
    const frames = context.frames
    const validFrames = Array.from(frames)
      .filter(frame => {
        try {
          return frame.frameElement && frame.frameElement.getAttribute('src')
        } catch (e) {
          logError(e)
          return false
        }
      })
      .map(async frame => {
        await delay(0)
        return await new Promise(resolve => {
          if (frame.document.readyState === 'complete') {
            resolve(frame)
          } else {
            frame.addEventListener('load', () => {
              resolve(frame)
            })
          }
        })
      })
    if (!validFrames.length) {
      return Promise.resolve([])
    }
    return Promise.all(validFrames) as Promise<Window[]>
  }

  private async waitingIFrameLoaded(frame: Window): Promise<Window | undefined> {
    try {
      frame.document && frame.frameElement && frame.frameElement.getAttribute('src')!
    } catch (e) {
      logError(e)
      return
    }

    return new Promise(resolve => {
      const timer = window.setInterval(() => {
        try {
          if (frame.document) {
            clearInterval(timer)
            resolve(frame)
          }
        } catch (e) {
          logError(e)
          clearInterval(timer)
          resolve(undefined)
        }
      }, 200)
    })
  }

  public async recordSubIFrames(context: Window) {
    const frames = await this.waitingSubIFramesLoaded(context)
    frames.forEach(frameWindow => {
      this.createIFrameRecorder(frameWindow)
    })
  }

  public async recordIFrame(context: Window) {
    const frameWindow = await this.waitingIFrameLoaded(context)
    if (frameWindow) {
      this.createIFrameRecorder(frameWindow)
    }
  }

  private createIFrameRecorder(frameWindow: Window) {
    const frameRecorder = new RecorderModule({
      ...this.options,
      context: frameWindow,
      keep: true,
      rootRecorder: this.options.rootRecorder || this,
      rootContext: this.options.rootContext
    })
    const frameElement = frameWindow.frameElement as Element & { frameRecorder: RecorderModule }
    frameElement.frameRecorder = frameRecorder
    this.destroyStore.add(() => frameRecorder.destroy())
  }

  private connectCompose(list: RecorderMiddleware[]) {
    return async (data: RecordData) => {
      return await list.reduce(
        (next: () => Promise<void>, fn: RecorderMiddleware) => {
          return this.createNext(fn, data, next)
        },
        () => Promise.resolve()
      )()
    }
  }

  private createNext(fn: RecorderMiddleware, data: RecordData, next: () => Promise<void>) {
    return async () => await fn(data, next)
  }

  private async deleteSome() {
    if (this.markSnapRecords.length === 2 && this.markSnapRecords[0].id) {
      this.db.delete({
        upperBound: this.markSnapRecords[0].id
      })
    }
  }

  private intervalDelDB() {
    const { write, writeKeepTime } = this.options
    if (write && writeKeepTime !== 0) {
      window.setInterval(async () => {
        this.deleteSome()
      }, writeKeepTime)
    }
  }
}
