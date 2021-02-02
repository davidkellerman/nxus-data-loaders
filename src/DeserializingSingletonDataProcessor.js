'use strict'

import DeserializingDataProcessor from './DeserializingDataProcessor.js'

/** Data processor for handling single serialized entity.
 * Adapts the `DeserializingDataProcessor` to processing a data entity
 * assigned to a single-valued container property (instead of a bucket
 * containing multiple data entities).
 */
class DeserializingSingletonDataProcessor extends DeserializingDataProcessor {
  constructor(...args) {
    super(...args)
    this._key = undefined
  }

  _getBucket() {
    let bucket = {}
    if (this._container[this._property])
      bucket[this._key] = this._container[this._property]
    return [bucket, false]
  }

  _setBucket(bucket) {
    let keys = Object.keys(bucket)
    if (keys.length > 1)
      throw new Error('received multiple data entities, at most one expected')
    else if (keys.length === 0) {
      this._container[this._property] = undefined
      this._key = undefined
    }
    else {
      this._container[this._property] = bucket[keys[0]]
      this._key = keys[0]
    }
  }
}

export {DeserializingSingletonDataProcessor as default}
