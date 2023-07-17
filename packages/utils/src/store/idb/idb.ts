/**
 * Copyright (c) oct16.
 * https://github.com/oct16
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { DBRecordData, RecordData, RecordType, TransactionMode } from '@timecat/share'

import { logError, getTime } from '../../tools'
import { Database } from './database'
import { READ_LIMIT_TIME } from './consts'

enum TaskTypes {
  'ADD',
  'DELETE',
  'CLEAR'
}
type Task = {
  type: TaskTypes
  data?: RecordData | DeleteOptions
}

type DeleteOptions = { lowerBound: number; upperBound: number }

export class IDB extends Database {
  tasks: Task[] = []

  constructor(DBName: string, version: number, storeName: string) {
    super(DBName, version, storeName)
  }

  public add(data: RecordData) {
    this.addTask(TaskTypes.ADD, data)
  }

  public delete(options: DeleteOptions) {
    this.addTask(TaskTypes.DELETE, options)
  }

  public clear() {
    this.addTask(TaskTypes.CLEAR)
  }

  public async count(): Promise<number> {
    const store = this.getIDBObjectStore(TransactionMode.READONLY)
    return new Promise(resolve => {
      store.count().onsuccess = event => {
        const count = event!.target!.result
        resolve(count)
      }
    })
  }

  public async last(): Promise<RecordData> {
    const store = this.getIDBObjectStore(TransactionMode.READONLY)

    return new Promise((resolve, reject) => {
      const openCursorRequest = store.openKeyCursor(null, 'prev')
      openCursorRequest.onsuccess = () => {
        const cursor = openCursorRequest.result
        if (!cursor) {
          return reject('DB is empty')
        }
        const request = store.get(cursor.key)
        request.onsuccess = () => {
          resolve(request.result)
        }
      }
    })
  }

  // limit 时间，不传时默认为 30 * 1000，即返回最近30秒的记录，传递为0时，返回全部
  public async readAll(options?: { limit: number }) {
    const { limit = READ_LIMIT_TIME } = options || {}
    const markTime = getTime()
    await this.dbResolve
    const store = this.getIDBObjectStore(TransactionMode.READONLY)
    let records: DBRecordData[] = []

    return new Promise(resolve => {
      store.getAll().onsuccess = event => {
        const storeRecords = event!.target!.result
        let snapDomRecord: any
        let snapCanvasRecords: any

        storeRecords.forEach((record: DBRecordData) => {
          const storeRecord: DBRecordData | null = record
          if (limit && markTime - record?.time > limit) {
            return false
          }

          if (limit) {
            !snapDomRecord && (snapDomRecord = record.snapDomRecord)
            !snapCanvasRecords && (snapCanvasRecords = record.snapCanvasRecords)
          }

          delete storeRecord.snapDomRecord
          delete storeRecord.snapCanvasRecords
          records.push(storeRecord)
        })

        // 还原快照 for dom
        if (limit && snapDomRecord && records[0]?.type !== RecordType.HEAD) {
          records = [snapDomRecord, ...records]
        }

        // 还原快照 for canvas
        if (limit && snapCanvasRecords) {
          records = [...snapCanvasRecords, ...records]
        }
        resolve(records)
      }
    }).then((arr: DBRecordData[]) => (arr.length ? arr : null))
    // This would be store.getAll(), but it isn't supported by IE now.
    // return new Promise(resolve => {
    //   store.openCursor().onsuccess = event => {
    //     const cursor = event!.target!.result
    //     if (cursor) {
    //       let storeRecord = cursor.value
    //       if (
    //         limit &&
    //         cursor.value &&
    //         cursor.value?.type > RecordType.SNAPSHOT &&
    //         markTime - cursor.value?.time > limit
    //       ) {
    //         storeRecord = null
    //       }
    //       storeRecord && records.push(storeRecord)
    //       cursor.continue()
    //       return
    //     }

    //     resolve(records)
    //   }
    // }).then((arr: DBRecordData[]) => (arr.length ? arr : null))
  }

  private execTask(task: Task) {
    switch (task.type) {
      case TaskTypes.ADD:
        return this.execAddTask(task.data as RecordData)
      case TaskTypes.DELETE:
        return this.execDeleteTask(task.data as DeleteOptions)
      case TaskTypes.CLEAR:
        return this.execClearTask()
      default:
        return Promise.resolve()
    }
  }

  private addTask(type: TaskTypes, data?: Task['data']) {
    this.tasks.push({
      type,
      data
    })
    this.triggerTask()
  }

  private async execAddTask(data: RecordData): Promise<void> {
    const objectStore = this.getIDBObjectStore(TransactionMode.READWRITE)
    objectStore.add(data)
  }

  private async execDeleteTask(options: DeleteOptions): Promise<void> {
    const { lowerBound, upperBound } = options || {}
    if (lowerBound && upperBound) {
      const keyRange = IDBKeyRange.bound(lowerBound, upperBound)
      const store = this.getIDBObjectStore(TransactionMode.READWRITE)
      store.delete(keyRange)
    } else {
      logError('Options lowerBound and upperBound is required')
    }
  }

  async execClearTask(): Promise<void> {
    const objectStore = this.getIDBObjectStore(TransactionMode.READWRITE)
    objectStore.clear()
  }

  private triggerTask = (() => {
    let timer = 0
    return () => {
      if (this.db) {
        let queue = Promise.resolve()
        while (this.tasks.length) {
          const task = this.tasks.shift()!
          queue = queue.then(() => this.execTask(task))
        }
      } else {
        clearInterval(timer)
        timer = window.setTimeout(() => this.triggerTask(), 0)
      }
    }
  })()
}
