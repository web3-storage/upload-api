/* eslint-disable no-loop-func, no-nested-ternary, no-only-tests/no-only-tests */
import { tasksStorageTests } from '@web3-storage/upload-api/test'
import { test } from '../helpers/context.js'
import {
  createS3,
  createR2,
  createDynamodDb,
  createSQS,
} from '../helpers/resources.js'
import { executionContextToUcantoTestServerContext } from '../helpers/ucan.js'
import { assertsFromExecutionContext } from '../helpers/assert.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    sqs: (await createSQS()).client,
    s3: (await createS3()).client,
    r2: (await createR2()).client,
  })
})

for (const [title, unit] of Object.entries(tasksStorageTests)) {
  const define = title.startsWith('only ')
    ? test.only
    : title.startsWith('skip ')
      ? test.skip
      : test
  define(title, async (t) => {
    await unit(
      assertsFromExecutionContext(t),
      await executionContextToUcantoTestServerContext(t)
    )
  })
}
