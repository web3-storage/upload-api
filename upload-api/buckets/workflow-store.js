import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import pRetry from 'p-retry'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * requested workflows to handle.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createWorkflowStore(region, bucketName, options = {}) {
  const s3client = getS3Client({
    region,
    ...options,
  })
  return useWorkflowStore(s3client, bucketName)
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types.js').WorkflowBucket}
 */
export const useWorkflowStore = (s3client, bucketName) => {
  return {
    /**
     * Put Workflow file with UCAN invocations into bucket.
     *
     * @param {string} cid
     * @param {Uint8Array} bytes
     */
    put: async (cid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${cid}/${cid}`,
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Get CAR bytes for a given invocation.
     *
     * @param {string} cid 
     */
    get: async (cid) => {
      const getObjectCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: `${cid}/${cid}`,
      })
      const s3Object = await s3client.send(getObjectCmd)
      const bytes = await s3Object.Body?.transformToByteArray()
      if (!bytes) {
        return
      }

      return bytes
    }
  }
}
