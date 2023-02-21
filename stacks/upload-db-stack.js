import { Table } from '@serverless-stack/resources'

import { storeTableProps, uploadTableProps } from '../upload-api/tables/index.js'
import {
  w3MetricsTableProps
} from '../ucan-invocation/tables/index.js'
import { setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UploadDbStack({ stack, app }) {

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * Used by the store/* service capabilities.
   */
   const storeTable = new Table(stack, 'store', storeTableProps)

  /**
   * This table maps stored CAR files (shards) to an upload root cid.
   * Used by the upload/* capabilities.
   */
  const uploadTable = new Table(stack, 'upload', uploadTableProps)

  /**
   * This table tracks w3 wider metrics.
   */
  const w3MetricsTable = new Table(stack, 'w3-metrics', w3MetricsTableProps)

  return {
    storeTable,
    uploadTable,
    w3MetricsTable
  }
}
