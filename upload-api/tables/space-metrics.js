import {
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on space metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createSpaceMetricsTable(region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return useSpaceMetricsTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').SpaceMetricsTable}
 */
export function useSpaceMetricsTable(dynamoDb, tableName) {
  return {
    /**
     * Return the total amount of of storage a space has used.
     * 
     * @param {import('@ucanto/interface').DIDKey} consumer the space whose current allocation we should return
     */
    getAllocated: async (consumer) => {
      const response = await dynamoDb.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          consumer,
          name: 'store/add-size-total'
        }),
        AttributesToGet: ['value']
      }))
      return response.Item ? unmarshall(response.Item).value : 0
    }
  }
}
