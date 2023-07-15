/**
 * Copyright (c) oct16.
 * https://github.com/oct16
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { completeAttrHref, completeCssHref, logError } from '@timecat/utils'

const ignoreNodeNames = ['VIDEO', 'IFRAME']

export function setAttribute(node: HTMLElement, name: string, value: string | boolean | null | object): void {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }
  if (name === 'style') {
    if (typeof value === 'string') {
      node.style.cssText = completeCssHref(value)
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k[0] === '-') {
          node.style.setProperty(k, v as any)
        } else {
          node.style[k as any] = v as any
        }
      }
    }
    return
  }

  // Compat SVG Namespaces
  if (name === 'xlink:href' && node.constructor.name === SVGUseElement.name) {
    node.setAttributeNS('http://www.w3.org/1999/xlink', name, value as any)
    return
  }

  if (name === 'src' && ~ignoreNodeNames.indexOf(node.tagName)) {
    return
  }

  // for disabled js prefetch
  if (value && typeof value === 'string' && /\.js$/.test(value)) {
    return
  }

  if (/^\d+/.test(name)) {
    return
  }

  if (/^on\w+$/.test(name)) {
    return
  }

  if (value === null) {
    return node.removeAttribute(name)
  }

  value = String(value)

  if (name === 'href') {
    value = completeAttrHref(String(value), node)
  }

  if (name === 'background' || name === 'src') {
    if (value.startsWith('data:')) {
      // skip
    } else {
      value = completeAttrHref(String(value), node)
    }
  }

  // The srcset attribute specifies the URL of the image to use in different situations
  if (name === 'srcset') {
    const srcArray = value.split(',')
    value = srcArray
      .map(src => {
        const [url, size] = src.trim().split(' ')
        if (url && size) {
          return `${completeAttrHref(url, node)} ${size}`
        }
        if (url) {
          return completeAttrHref(url, node)
        }
        return ''
      })
      .join(', ')
    // decode uri
    value = decodeURIComponent(value)
  }

  if (value.startsWith('/')) {
    value = completeAttrHref(value, node)
  }

  try {
    node.setAttribute(name, value)
  } catch (err) {
    logError(err)
  }
}
