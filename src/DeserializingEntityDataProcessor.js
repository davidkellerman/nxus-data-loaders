'use strict'

import isEqual from 'lodash/isEqual'

const nullSerialization = {
  wrapEntity(entity, context) { return entity }
}

/** Data processor for handling serialized entities.
 * Provides data processing functions for entity data loading and
 * editing elements. (Such as `<streamed-data-loader>`.)
 *
 * The processing function deserializes incoming entities and transfers
 * them to storage. Storage is an associative array (called a _bucket_,
 * for want of a better term), defined as a property of a container
 * object.
 *
 * Updating of the bucket is designed to "play nice" with code that
 * responds to changes in the bucket and its contents (various Web
 * Components). An incoming entity won't replace an existing stored
 * entity if the two are equal (the existing object is preserved for
 * the benefit of code that detects changes through object equality).
 * If data loading results in changes, the bucket is copied (again,
 * for code that checks object equality).
 *
 * If the bucket is undefined when the processing function is invoked,
 * it is created (it will be empty if no data was loaded).
 *
 * A note on entity keys: Data loaders deliver data entities along
 * with an identifying key for each entity. Depending on the loader,
 * the key may have a prefix that should be removed by the processor.
 * If the processor is configured with a `keyPrefix` option, incoming
 * keys are expected to have the form `<key-prefix>.<key>`, and the
 * prefix and separator are discarded.
 *
 * When the data processing function removes an existing data
 * entity from the element property (because it is replacing the
 * entity or replacing the element property in its entirety), it
 * invokes the entity's `destroy()` method, if one is defined.
 *
 * @param {Object} container - container element; the _bucket_ where
 *   incoming entities are stored is a property of the container
 * @param {string} property - name of the container bucket property
 * @param {Object} options - data processing options:
 * *   `serialization` (`Object`) - entity serialization object;
 *       provides a `wrapEntity(entity, context)` method for
 *       deserializing incoming entities
 * *   `keyPrefix` (`String`) - key prefix for data entities; default
 *       is the `property` parameter
 */
class DeserializingEntityDataProcessor {

  constructor(container, property, options) {
    this._container = container
    this._property = property
    this._config = {serialization: nullSerialization, keyPrefix: property, ...options}
  }

  /** Data processing function for a stream of data entities.
   *
   * Loaded data entities are delivered by a `ReadableStream` that
   * supplies a sequence of two-element arrays comprised of the entity
   * key and the entity itself.
   *
   * The data processing function takes these parameters:
   * *   `entities` **ReadableStream** - the data entity stream 
   * *   `header` **Object** - header object; properties:
   *     *   `update` - if true, update the storage bucket; otherwise,
   *         replace its content in its entirety
   *
   * @return {Function} data processor
   */
  get streamedDataProcessor() {
    return this._streamedDataProcessor.bind(this)
  }

  async _streamedDataProcessor(stream, header) {
    const destroyEntity = (entity) => { if (entity.destroy) entity.destroy() }
    const equalEntities = (entity1, entity2) => { return entity1.isEqual ? entity1.isEqual(entity2) : isEqual(entity1, entity2) }

    // get bucket holding entities;
    //   if replacing all existing entities (not an update),
    //   provisionally mark existing entities for destruction
    let bucket = this._container[this._property],
        toDestroy = new Set(),
        toAdd = new Map(),
        changes = false
    if (!bucket) { bucket = {}; changes = true }
    for (let last in bucket)
      toDestroy.add(last)

    // process entities, accumulate adds and destroys
    const reader = stream.getReader()
    for (;;) {
      let {done, value} = await reader.read()
      if (done) break
      let [key, entity] = value
      // determine id for entity; ignore entities with invalid coding
      let last, okay
      if (this._config.keyPrefix) {
        let path = key.split('.'), first = path.shift()
        last = path.shift()
        okay = (first === this._config.keyPrefix) && last && (path.length === 0)
      }
      else {
        last = key
        okay = last
      }
      if (!okay) {
        console.log(`${this._property} data processor found invalid path (${key})`)
        continue
      }
      // decide what to do with entity;
      //   if undefined, mark existing entity for destruction;
      //   if same as existing entity, leave existing entity unchanged
      if (entity == undefined) {
        if (bucket[last]) toDestroy.add(last)
      }
      else {
        entity = this._config.serialization.wrapEntity(entity, this._container)
        if (!bucket[last])
          toAdd.set(last, entity)
        else {
          if (equalEntities(bucket[last], entity))
            toDestroy.delete(last)
          else {
            toDestroy.add(last)
            toAdd.set(last, entity)
          }
        }
      }
    }

    let entitiesCount = Object.keys(bucket).length,
        toAddCount = toAdd.size,
        toDestroyCount = toDestroy.size

    let clauses = [`${entitiesCount} entities`]
    if (header.update) clauses.push('update')
    if (toAddCount > 0) clauses.push(`${toAddCount} to add`)
    if (toDestroyCount > 0) clauses.push(`${toDestroyCount} to destroy`)
    if ((toAddCount === 0) && (toDestroyCount === 0)) clauses.push('no changes')
    console.log(`${this._property} data processor, ${clauses.join(', ')}`)

    // apply changes to bucket
    changes = changes || (toAddCount > 0) || (toDestroyCount > 0)
    if (changes) {
      for (let last of toDestroy) {
        destroyEntity(bucket[last])
        delete bucket[last]
      }
      for (let [last, entity] of toAdd) {
        bucket[last] = entity
      }
      this._container[this._property] = Object.assign({}, bucket)
    }
  }

}

export {DeserializingEntityDataProcessor as default}
