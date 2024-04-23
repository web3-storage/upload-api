import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { RecordKeyConflict, RecordNotFound, StorageOperationFailed } from '@web3-storage/upload-api/errors'
import { base58btc } from 'multiformats/bases/base58'
import * as Link from 'multiformats/link'

/**
 * @typedef {import('@web3-storage/upload-api/types').AllocationsStorage} AllocationsStorage
 * @typedef {import('@web3-storage/upload-api/types').BlobAddInput} BlobAddInput
 * @typedef {import('@web3-storage/upload-api/types').BlobListItem} BlobListItem
 * @typedef {import('@web3-storage/upload-api/types').ListOptions} ListOptions
 * @typedef {import('@web3-storage/upload-api/types').DID} DID
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {AllocationsStorage}
 */
export const createAllocationsStorage = (region, tableName, options = {}) => {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useAllocationsStorage(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {AllocationsStorage}
 */
export function useAllocationsStorage(dynamoDb, tableName) {
  return {
    /**
     * Check if the given link CID is bound to the uploader account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {Uint8Array} blobMultihash
     * @returns {ReturnType<AllocationsStorage['exists']>}
     */
    exists: async (space, blobMultihash) => {
      const key = getKey(space, blobMultihash)
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: key,
        AttributesToGet: ['space'],
      })

      try {
        const response = await dynamoDb.send(cmd)
        return { ok: Boolean(response.Item) }
      } catch {
        return { ok: false }
      }
    },
    /**
     * @param {import('@web3-storage/upload-api').DID} space
     * @param {Uint8Array} blobMultihash
     * @returns {ReturnType<AllocationsStorage['get']>}
     */
    async get(space, blobMultihash) {
      const key = getKey(space, blobMultihash)
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: key,
      })

      const response = await dynamoDb.send(cmd)
      if (!response.Item) {
        return { error: new RecordNotFound() }
      }

      const raw = unmarshall(response.Item)
      return {
        ok: {
          blob: {
            digest: base58btc.decode(raw.multihash),
            size: raw.size
          },
          cause: Link.parse(raw.cause)
        }
      }
    },
    /**
     * Bind a link CID to an account
     *
     * @param {BlobAddInput} item
     * @returns {ReturnType<AllocationsStorage['insert']>}
     */
    insert: async ({ space, blob, cause }) => {
      const insertedAt = new Date().toISOString()
      const multihash58btc = base58btc.encode(blob.digest)

      const item = {
        space,
        multihash: multihash58btc,
        size: blob.size,
        cause: cause.toString(),
        insertedAt,
      }
      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(#S) AND attribute_not_exists(#M)',
        ExpressionAttributeNames: { '#S': 'space', '#M': 'multihash' }
      })

      try {
        await dynamoDb.send(cmd)
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return { error: new RecordKeyConflict() }
        }
        throw err
      }
      return { ok: { blob } }
    },
    /**
     * @param {import('@web3-storage/upload-api').DID} space
     * @param {Uint8Array} blobMultihash
     * @returns {ReturnType<AllocationsStorage['remove']>}
     */
    async remove(space, blobMultihash) {
      const key = getKey(space, blobMultihash)
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: key,
        ConditionExpression: 'attribute_exists(#S) AND attribute_exists(#M)',
        ExpressionAttributeNames: { '#S': 'space', '#M': 'multihash' },
        ReturnValues: 'ALL_OLD'
      })

      try {
        const res = await dynamoDb.send(cmd)
        if (!res.Attributes) {
          throw new Error('missing return values')
        }

        const raw = unmarshall(res.Attributes)
        return {
          ok: {
            size: Number(raw.size)
          }
        }
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return {
            ok: {
              size: 0
            }
          }
        }
        return {
          error: new StorageOperationFailed(err.name)
        }
      }
    },
    /**
     * List all CARs bound to an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').ListOptions} [options]
     * @returns {ReturnType<AllocationsStorage['list']>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor
        ? marshall({
            space,
            link: options.cursor,
          })
        : undefined

      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options.size || 20,
        KeyConditions: {
          space: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: space }],
          },
        },
        ScanIndexForward: !options.pre,
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['multihash', 'size', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      const results =
        response.Items?.map((i) => toBlobListResult(unmarshall(i))) ?? []
      const firstLinkCID = results[0] ? base58btc.encode(results[0].blob.digest) : undefined
      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey =
        response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const lastLinkCID = lastKey ? lastKey.multihash : undefined

      const before = options.pre ? lastLinkCID : firstLinkCID
      const after = options.pre ? firstLinkCID : lastLinkCID
      return {
        ok: {
          size: results.length,
          before,
          after,
          cursor: after,
          results: options.pre ? results.reverse() : results,
        }
      }
    },
  }
}

/**
 * Upgrade from the db representation
 *
 * @param {Record<string, any>} item
 * @returns {BlobListItem}
 */
export function toBlobListResult({ multihash, size, insertedAt }) {
  return {
    blob: {
      digest: base58btc.decode(multihash),
      size
    },
    insertedAt,
  }
}

/**
 * @param {import('@web3-storage/upload-api').DID} space
 * @param {Uint8Array} blobMultihash
 */
const getKey = (space, blobMultihash) => {
  const multihash58btc = base58btc.encode(blobMultihash)
  const item = {
    space,
    multihash: multihash58btc.toString(),
  }

  return marshall(item)
}
