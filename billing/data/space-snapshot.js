import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').SpaceSnapshot} SpaceSnapshot
 * @typedef {import('../types').InferStoreRecord<SpaceSnapshot> & { pk: string }} SpaceSnapshotStoreRecord
 * @typedef {import('../lib/api').SpaceSnapshotKey} SpaceSnapshotKey
 * @typedef {Omit<import('../types').InferStoreRecord<SpaceSnapshotKey>, 'provider'|'space'> & { pk: string }} SpaceSnapshotKeyStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

export const schema = Schema.struct({
  provider: Schema.did({ method: 'web' }),
  space: Schema.did(),
  size: Schema.bigint().greaterThanEqualTo(0n),
  recordedAt: Schema.date(),
  insertedAt: Schema.date()
})

/** @type {import('../lib/api').Validator<SpaceSnapshot>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api').Encoder<SpaceSnapshot, SpaceSnapshotStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        pk: `${input.space}#${input.provider}`,
        space: input.space,
        provider: input.provider,
        size: input.size.toString(),
        recordedAt: input.recordedAt.toISOString(),
        insertedAt: input.insertedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space snapshot record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Encoder<SpaceSnapshotKey, SpaceSnapshotKeyStoreRecord>} */
export const encodeKey = input => ({
  ok: {
    pk: `${input.space}#${input.provider}`,
    recordedAt: input.recordedAt.toISOString()
  }
})

/** @type {import('../lib/api').Decoder<StoreRecord, SpaceSnapshot>} */
export const decode = input => {
  try {
    return {
      ok: {
        space: Schema.did().from(input.space),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        size: BigInt(input.size),
        recordedAt: new Date(input.recordedAt),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding space snapshot record: ${err.message}`)
    }
  }
}
