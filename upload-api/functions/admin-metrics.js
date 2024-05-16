import * as Sentry from '@sentry/serverless'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'
import * as DAGJson from '@ipld/dag-json'

import { updateAdminMetrics } from '../metrics.js'
import { createMetricsTable } from '../stores/metrics.js'
import { createCarStore } from '../buckets/car-store.js'
import { createAllocationsStorage } from '../stores/allocations.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
async function handler(event) {
  const ucanInvocations = parseKinesisEvent(event)
  const {
    metricsTableName,
    storeBucketName,
    allocationTableName,
  } = getLambdaEnv()

  await updateAdminMetrics(ucanInvocations, {
    metricsStore: createMetricsTable(AWS_REGION, metricsTableName),
    carStore: createCarStore(AWS_REGION, storeBucketName),
    allocationsStorage: createAllocationsStorage(AWS_REGION, allocationTableName)
  })
}

function getLambdaEnv () {
  return {
    metricsTableName: mustGetEnv('ADMIN_METRICS_TABLE_NAME'),
    storeBucketName: mustGetEnv('STORE_BUCKET_NAME'),
    allocationTableName: mustGetEnv('ALLOCATION_TABLE_NAME'),
  }
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
function parseKinesisEvent (event) {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => DAGJson.parse(toString(b, 'utf8')))
}
