import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, asDIDMailto } from './lib.js'

/**
 * @typedef {import('../lib/api').Customer} Customer
 * @typedef {import('../types').InferStoreRecord<Customer>} CustomerStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

/** @type {import('../lib/api').Encoder<Customer, CustomerStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        cause: input.cause.toString(),
        customer: input.customer,
        account: input.account,
        product: input.product,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding customer record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Decoder<StoreRecord, Customer>} */
export const decode = input => {
  try { 
    return {
      ok: {
        cause: Link.parse(String(input.cause)),
        customer: asDIDMailto(input.customer),
        account: String(input.account),
        product: String(input.product),
        insertedAt: new Date(input.insertedAt),
        updatedAt: new Date(input.updatedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding customer record: ${err.message}`)
    }
  }
}
