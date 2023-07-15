/*
 * @Author: zhanglitao@zuoyebang.com
 * @Date: 2023-07-12 14:33:15
 * @LastEditors: zhanglitao@zuoyebang.com
 * @LastEditTime: 2023-07-15 14:41:01
 * @FilePath: /TimeCat/packages/recorder/src/types.ts
 * @Description: type
 */
import { DBRecordData, RecordData } from '@timecat/share'
import { RecorderModule } from '@timecat/timecat'
import { RecorderPlugin } from './pluginable'
import { watchers } from './watchers'

export type RecorderMiddleware = (data: RecordData, n: () => Promise<void>) => Promise<void>

export type ReadDB = (options?: { limit: number }) => Promise<DBRecordData[] | null>

interface RecordVideoOptions {
  fps: number
}

interface RecordOptionsBase {
  rootRecorder?: RecorderModule
  context?: Window
  rootContext?: Window
  audio?: boolean
  video?: boolean | RecordVideoOptions
  write?: boolean
  keep?: boolean
  emitLocationImmediate?: boolean
  font?: boolean
  disableWatchers?: Array<keyof typeof watchers>
  keepAlive?: number | false
}

export interface RecordInternalOptions extends Required<RecordOptions> {
  context: Window
  video: boolean | RecordVideoOptions
}

interface RewriteConfig {
  replaceOrigin?: string
  folderPath?: string
  fn?: (pre: string, next: string) => string | void
}

interface PreFetchRewriteConfig extends RewriteConfig {
  matches?: (string | RegExp)[]
  crossUrl?: string
}

export type RewriteResource = RewriteItem[]

export enum RecorderStatus {
  RUNNING = 'running',
  PAUSE = 'pause',
  HALT = 'halt'
}

export interface RecordOptions extends RecordOptionsBase {
  plugins?: RecorderPlugin[]
  rewriteResource?: RewriteResource
}

export interface RewriteItem {
  matches: (string | RegExp)[]
  type?: string
  rewrite: PreFetchRewriteConfig & RewriteConfig
}
