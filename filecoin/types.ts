import {
  Signer,
  DID,
  Principal,
  Proof,
} from '@ucanto/interface'
import { PieceRecord, PieceRecordKey } from '@storacha/filecoin-api/storefront/api'

export interface FilecoinMetricsStore {
  incrementTotal: (metricName: string, n: number) => Promise<void>
  incrementTotals: (metricsToUpdate: Record<string, number>) => Promise<void>
}

export interface FilecoinMetricsCtx {
  filecoinMetricsStore: FilecoinMetricsStore
  workflowStore: WorkflowBucket
  startEpochMs?: number
}

export interface FilecoinAggregateOfferMetricsCtx extends FilecoinMetricsCtx {
  invocationStore: InvocationBucket
}

export interface WorkflowBucket {
  get: (Cid: string) => Promise<Uint8Array|undefined>
}

export interface InvocationBucket {
  getInLink: (cid: string) => Promise<string|undefined>
}


export interface ClaimsInvocationConfig {
  /**
   * Signing authority that is issuing the UCAN invocation(s).
   */
  issuer: Signer
  /**
   * The principal delegated to in the current UCAN.
   */
  audience: Principal
  /**
   * The resource the invocation applies to.
   */
  with: DID
  /**
   * Proof(s) the issuer has the capability to perform the action.
   */
  proofs?: Proof[]
}

// Store records
export type InferStoreRecord<T> = {
  [Property in keyof T]: T[Property] extends Number ? T[Property] : string
}

export interface PieceStoreRecord extends Omit<InferStoreRecord<PieceRecord>, 'status'> {
  stat: number
}

export interface PieceStoreRecordKey extends InferStoreRecord<PieceRecordKey> {}

export enum PieceStoreRecordStatus {
  Submitted = 0,
  Accepted = 1,
  Invalid = 2
}


export class Failure extends Error {
  describe() {
    return this.toString()
  }
  get message() {
    return this.describe()
  }
  toJSON() {
    const { name, message, stack } = this
    return { name, message, stack }
  }
}

export type Result<T = unknown, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

/**
 * Utility type for defining a [keyed union] type as in IPLD Schema. In practice
 * this just works around typescript limitation that requires discriminant field
 * on all variants.
 *
 * ```ts
 * type Result<T, X> =
 *   | { ok: T }
 *   | { error: X }
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *   //  ^^^^^^^^^ Property 'ok' does not exist on type '{ error: Error; }`
 *   }
 * }
 * ```
 *
 * Using `Variant` type we can define same union type that works as expected:
 *
 * ```ts
 * type Result<T, X> = Variant<{
 *   ok: T
 *   error: X
 * }>
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *     result.ok.toUpperCase()
 *   }
 * }
 * ```
 *
 * [keyed union]:https://ipld.io/docs/schemas/features/representation-strategies/#union-keyed-representation
 */
export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]

// would be generated by sst, but requires `sst build` to be run, which calls out to aws; not great for CI
declare module 'sst/node/config' {
  export interface SecretResources {
    PRIVATE_KEY: {
      value: string
    }
  }
}

export {}
