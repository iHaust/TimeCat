/*
 * @Author: zhanglitao@zuoyebang.com
 * @Date: 2023-07-12 15:11:18
 * @LastEditors: zhanglitao@zuoyebang.com
 * @LastEditTime: 2023-07-18 15:43:36
 * @FilePath: /TimeCat/packages/recorder/src/snapshot.ts
 * @Description: 增加类开放静态方法 DOMSnapshotData
 */

import { Watcher } from './watcher'
import {
  SnapshotRecord,
  RecordType,
  InfoData,
  VNode,
  VSNode,
  PreFetchRecordData,
  CanvasRecord,
  RecordData
} from '@timecat/share'
import { createElement, requestElement } from '@timecat/virtual-dom'
import { nodeStore, isVNode, getTime } from '@timecat/utils'
import { rewriteNodes } from './common'
import { isCanvasBlank } from './watchers/canvas/utils'

export class Snapshot extends Watcher<SnapshotRecord> {
  protected init() {
    const snapshotData = this.DOMSnapshotData(this.options.context || window)
    const time = getTime()
    this.checkNodesData(snapshotData, time)
    this.emitData(RecordType.SNAPSHOT, snapshotData, time)
  }

  private DOMSnapshotData(context: Window): SnapshotRecord['data'] {
    return {
      vNode: createElement(context.document.documentElement) as VNode,
      ...this.getInitInfo(context)
    }
  }

  private getInitInfo(context: Window): InfoData {
    const { name, publicId, systemId } = context.document.doctype || {}
    const doctype = () => ({ name, publicId, systemId } as DocumentType)
    const href = () => context.location.href
    const width = () => context.innerWidth
    const height = () => context.innerHeight
    const scrollTop = () => context.pageYOffset
    const scrollLeft = () => context.pageXOffset
    const [base] = document.getElementsByTagName('base')

    const getFrameElement = () => context.frameElement
    const frameElement = getFrameElement()
    const frameId = nodeStore.getNodeId(frameElement!) || null
    const baseHref = base?.href

    return {
      doctype: doctype(),
      href: baseHref || href(),
      scrollTop: scrollTop(),
      scrollLeft: scrollLeft(),
      width: width(),
      height: height(),
      frameId
    }
  }

  private checkNodesData({ vNode }: { vNode: VNode }, time: number) {
    const { G_RECORD_OPTIONS: options } = window
    const configs = options?.rewriteResource || []
    if (!configs?.length) {
      return
    }

    const deepLoopChildNodes = (children: (VNode | VSNode)[]) => {
      const vNodes: VNode[] = []
      children.forEach(child => {
        const c = child as VNode
        if (isVNode(c)) {
          vNodes.push(c, ...deepLoopChildNodes(c.children))
        }
      })
      return vNodes
    }

    rewriteNodes(deepLoopChildNodes(vNode.children), configs, data => {
      this.emitData(RecordType.PATCH, data as PreFetchRecordData, time + 1)
    })
  }

  private requestDOMSnapshotData(context: Window): SnapshotRecord['data'] {
    return {
      vNode: requestElement(context.document.documentElement) as VNode,
      ...this.getInitInfo(context)
    }
  }

  private getDOMSnapshotData(context: Window): SnapshotRecord['data'] {
    return this.requestDOMSnapshotData(context)
  }

  private getCanvasSnapshotData(canvas: HTMLCanvasElement) {
    if (isCanvasBlank(canvas)) {
      return false
    }
    const dataURL = canvas.toDataURL()
    return {
      id: nodeStore.getNodeId(canvas),
      src: dataURL
    }
  }

  static GetSnapDomForRecord(context: Window, record: RecordData): RecordData {
    return {
      type: RecordType.SNAPSHOT,
      data: this.prototype.getDOMSnapshotData(context),
      relatedId: record.relatedId,
      time: record.time
    }
  }

  static GetSnapCanvasForRecords(canvasList: HTMLCollectionOf<HTMLCanvasElement>, record: RecordData): RecordData[] {
    const result: RecordData[] = []
    Array.from(canvasList).forEach(canvas => {
      const canvasData = this.prototype.getCanvasSnapshotData(canvas)
      canvasData &&
        result.push({
          type: RecordType.CANVAS_SNAPSHOT,
          data: canvasData as any,
          relatedId: record.relatedId,
          time: record.time
        })
    })
    return result
  }
}
