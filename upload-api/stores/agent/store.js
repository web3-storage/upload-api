import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import {
  RecordNotFound,
  StorageOperationFailed,
} from '@web3-storage/upload-api/errors'
import * as CAR from '@ucanto/transport/car'
import { Invocation, parseLink, Receipt } from '@ucanto/core'
import * as API from '../../types.js'

export { API }

/**
 * @typedef {import('@aws-sdk/client-s3').S3ClientConfig & {region:string}} Address
 * @typedef {S3Client} Channel
 *
 * @typedef {API.Variant<{
 *   channel: Channel
 *   address: Address
 * }>} Connection
 *
 * @typedef {object} Buckets
 * @property {{name:string}} index
 * @property {{name:string}} message
 *
 * @typedef {object} Options
 * @property {Connection} connection
 * @property {Buckets} buckets
 *
 * @typedef {object} Store
 * @property {Channel} channel
 * @property {Buckets} buckets
 */

/**
 * @param {Options} options
 * @returns {Store}
 */
export const open = ({ connection, buckets }) => ({
  channel: connection.channel ?? new S3Client(connection.address),
  buckets,
})

/**
 * @param {Store} store
 * @param {API.ParsedAgentMessage} message
 * @returns {Promise<API.Result<API.Unit, Error>>}
 */
export const write = async (store, message) => {
  const [...commands] = assert(store, message)
  try {
    await Promise.all(commands.map((command) => store.channel.send(command)))
    return { ok: {} }
  } catch (cause) {
    return {
      error: /** @type {Error} */ (cause),
    }
  }
}

/**
 * Iterates over all invocations and receipts and yields corresponding S3 Put
 * commands.
 *
 * @param {Store} store
 * @param {API.ParsedAgentMessage} message
 */
export function* assert({ buckets }, message) {
  const id = message.data.root.cid
  // If the `content-type` is set to `application/vnd.ipld.car` than message
  // source is in the format we store store it in. Otherwise we need to encode
  // message into CAR format.
  const { body } =
    message.source.headers['content-type'] === CAR.codec.contentType
      ? message.source
      : CAR.response.encode(message.data)

  // Store a message in the message object store under the key `${id}/${id}`
  yield new PutObjectCommand({
    Bucket: buckets.message.name,
    Key: `${id}/${id}`,
    Body: body,
  })

  // Index all the invocations and receipts enclosed in the agent message
  for (const entry of message.index) {
    if (entry.invocation) {
      const { task, invocation, message } = entry.invocation
      // Index invoked task by the task CID so it could be looked up and
      // loaded later.
      yield new PutObjectCommand({
        Bucket: buckets.index.name,
        Key: `${task}/${invocation}@${message}.in`,
      })
    }

    if (entry.receipt) {
      const { task, receipt, message } = entry.receipt
      // Store mapping for where each receipt lives in agent message file.
      // a pseudo symlink to `${message.cid}/${message.cid}` via key
      // `${invocation.cid}/${message.cid}.out` to track where each receipt
      // lives in a agent message file. As a pseudo symlink, it is an empty
      // object.
      yield new PutObjectCommand({
        Bucket: buckets.index.name,
        Key: `${task}/${receipt}@${message}.out`,
      })
    }
  }
}

/**
 * Gets a invocation corresponding to the given task.
 *
 * @param {Store} store
 * @param {API.UnknownLink} task
 */
export const getInvocation = async (store, task) => {
  const result = await load(store, { invocation: task })

  if (result.error) {
    return result
  }

  // If we have no root in the resolved message we deal with a legacy index
  // in which case `task === invocation`.
  const invocation = result.ok.root ?? task

  const view = Invocation.view(
    {
      root: /** @type {API.UCANLink<[API.Capability]>} */ (invocation),
      blocks: result.ok.archive.blocks,
    },
    null
  )

  return view ? { ok: view } : { error: new RecordNotFound() }
}

/**
 * Gets a receipt corresponding to the given task.
 *
 * @param {Store} store
 * @param {API.UnknownLink} task
 */
export const getReceipt = async (store, task) => {
  const result = await load(store, { invocation: task })

  if (result.error) {
    return result
  }

  //
  const invocation = /** @type {API.UCANLink<[API.Capability]>} */ (task)
  const { ok: entry, error } = await resolve(store, {
    receipt: invocation,
  })
  if (error) {
    return { error }
  }

  const { ok: body, error: readError } = await read(store, entry.at)
  if (readError) {
    return { error: readError }
  }

  if (entry.root) {
    const archive = await CAR.codec.decode(body)
    const receipt = Receipt.view(
      {
        root: /** @type {API.Link<API.ReceiptModel>} */ (parseLink(entry.root)),
        blocks: archive.blocks,
      },
      null
    )
    if (receipt) {
      return { ok: receipt }
    }
  } else {
    const message = await CAR.request.decode({
      body,
      headers: {},
    })

    // Attempt to find a receipt corresponding to this task
    const receipt = message.receipts.get(`${task}`)
    if (receipt) {
      return { ok: receipt }
    }
  }

  return {
    error: new RecordNotFound(
      `agent message ${entry.at} does not contain receipt for ${task} task`
    ),
  }
}

/**
 * We may want to lookup an agent message by task that either contains
 * corresponding invocation or a receipt . This type describes a query
 * as variant of `invocation` and `receipt` types signaling which of the
 * two messages to lookup.
 *
 * @typedef {API.Variant<{
 *    invocation: API.UnknownLink
 *    receipt: API.UnknownLink
 * }>}  AgentMessageQuery
 */

/**
 * Resolves paths to an agent message for the given key.
 *
 * @typedef {{root?: string, at:string}} IndexEntry
 *
 * @param {Store} store
 * @param {AgentMessageQuery} query
 * @returns {Promise<API.Result<IndexEntry, RecordNotFound|StorageOperationFailed>>}
 */
const resolve = async (store, { invocation, receipt }) => {
  // If we are resolving an invocation we need to find an INcoming message
  // which get `.in` suffix. If we are looking for a receipt we need to find
  // an OUTgoing message which get `.out` suffix.
  const [prefix, suffix] = invocation
    ? [`${invocation}/`, '.in']
    : [`${receipt}/`, '.out']

  // Previously we used to treat task and invocation as a same and used
  // following indexing using following pseudo symlinks
  //
  // ${invocation.cid}/${message.cid}.in
  // ${invocation.cid}/${message.cid}.out
  //
  // After we started distinguishing between task and invocation, we have
  // adopted following indexing instead
  // ${task.cid}/${invocation.cid}@${message.cid}.in
  // ${task.cid}/${invocation.cid}@${message.cid}.out
  //
  // Here we could be looking up old receipts or new ones which is why we
  // simply list all entries under the link (which is either task or invocation)
  // and then filter out by the prefix.
  const entries = await list(store, { prefix, suffix })
  if (entries.error) {
    return entries
  }

  // Prefer an entry containing a root link if non found return the first entry
  const [first, ...rest] = entries.ok
  const head = toIndexEntry(first)
  if (head.root) {
    return { ok: head }
  } else {
    for (const path of rest) {
      const entry = toIndexEntry(path)
      if (entry.root) {
        return { ok: entry }
      }
    }
    return { ok: head }
  }
}

/**
 * Loads a view based on the query
 *
 *
 * @param {Store} store
 * @param {AgentMessageQuery} query
 */
const load = async (store, query) => {
  const { ok: index, error } = await resolve(store, query)

  if (error) {
    return { error }
  }

  const { at, root } = index
  const { ok: bytes, error: readError } = await read(store, at)
  if (readError) {
    return { error: readError }
  }

  return {
    ok: {
      archive: await CAR.codec.decode(bytes),
      root: root ? parseLink(root) : null,
    },
  }
}
/**
 * Takes a pseudo symlink and extracts the DAG `root` and DAG `archive`
 * identifiers.
 *
 * @param {string} path
 */
const toIndexEntry = (path) => {
  const start = path.indexOf('/')
  const offset = path.indexOf('@')
  return offset > 0
    ? {
        root: path.slice(start, offset),
        at: path.slice(offset + 1, path.indexOf('.')),
      }
    : {
        at: path.slice(start + 1, path.indexOf('.')),
      }
}

/**
 *
 * @param {Store} connection
 * @param {object} key
 * @param {string} key.prefix
 * @param {string} key.suffix
 * @returns {Promise<API.Result<[string, ...string[]], RecordNotFound|StorageOperationFailed>>}
 */
const list = async (connection, { prefix, suffix }) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: connection.buckets.index.name,
      Prefix: prefix,
    })

    const { Contents } = await connection.channel.send(command)
    const entries =
      Contents?.map((c) => c.Key ?? '').filter((key) => key.endsWith(suffix)) ??
      []

    return entries.length > 0
      ? { ok: /** @type {[string, ...string[]]} */ (entries) }
      : {
          error: new RecordNotFound(
            `any pseudo symlink from invocation ${prefix}*${suffix} was found`
          ),
        }
  } catch (/** @type {any} */ error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return {
        error: new RecordNotFound(
          `any pseudo symlink from invocation ${prefix}*${suffix} was found`
        ),
      }
    }
    return {
      error: new StorageOperationFailed(error.message),
    }
  }
}

/**
 * @param {Store} connection
 * @param {string} at
 * @returns {Promise<API.Result<Uint8Array, RecordNotFound|StorageOperationFailed>>}
 */
const read = async ({ buckets, channel }, at) => {
  const getCmd = new GetObjectCommand({
    Bucket: buckets.index.name,
    Key: `${at}/${at}`,
  })

  let res
  try {
    res = await channel.send(getCmd)
  } catch (/** @type {any} */ error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return {
        error: new RecordNotFound(
          `agent message archive ${at} not found in store`
        ),
      }
    }
    return {
      error: new StorageOperationFailed(error.message),
    }
  }
  if (!res || !res.Body) {
    return {
      error: new RecordNotFound(
        `agent message archive ${at} not found in store`
      ),
    }
  }

  const bytes = await res.Body.transformToByteArray()

  return {
    ok: bytes,
  }
}
