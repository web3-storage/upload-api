import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { lister, decode, encodeKey } from '../data/allocations.js'
import { allocationTableProps } from '../../upload-api/tables/index.js'

export { allocationTableProps }

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api').AllocationStore}
 */
export const createAllocationStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStoreListerClient(conf, {
    tableName,
    indexName: 'space-insertedAt-index',
    ...lister,
  }),
})
