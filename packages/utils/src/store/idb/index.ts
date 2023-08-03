/*
 * @Author: zhanglitao@zuoyebang.com
 * @Date: 2023-07-18 16:57:49
 * @LastEditors: zhanglitao@zuoyebang.com
 * @LastEditTime: 2023-08-03 11:53:44
 * @FilePath: /TimeCat/packages/utils/src/store/idb/index.ts
 * @Description: some description for file
 */
/**
 * Copyright (c) oct16.
 * https://github.com/oct16
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { DB_NAME, DB_TABLE, DEFAULT_PAGE_NAME } from '../consts'
import { IDB } from './idb'
export { IDB } from './idb'

let idbInstance: IDB

export const idb = (key: string = DEFAULT_PAGE_NAME) => {
  if (idbInstance) return idbInstance
  return (idbInstance = new IDB(DB_NAME, 2, `${DB_TABLE}__${key}`))
}
