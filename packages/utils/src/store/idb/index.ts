/**
 * Copyright (c) oct16.
 * https://github.com/oct16
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { DB_NAME, DB_TABLE } from './consts'
import { IDB } from './idb'
export { IDB } from './idb'

export const idb = new IDB(DB_NAME, 1, DB_TABLE)
