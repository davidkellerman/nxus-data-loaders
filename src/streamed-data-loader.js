'use strict'

/* eslint new-cap: ["warn", { "capIsNewExceptions": ["PooledDataRequestMixin"] }] */

import {LitElement} from 'lit-element'
import ndjsonStream from "can-ndjson-stream"
import pick from 'lodash/pick'

import PooledDataRequest from './PooledDataRequest.js'
import {sharedDataLoaders} from './SharedDataLoaders.js'

const errorDelay = 60 * 1000

const unloadedStateBit = 1
const errorStateBit = 2

const nullSerialization = {
  wrapEntity(entity, container) { return entity }
}


/** Streamed Data Loader.
 *
 * It doesn't maintain any local reference to the loaded data (in part
 * because the data may be large). Instead, it passes loaded data to a
 * data processing function to transform or store it.
 *
 * #### Response format
 *
 * The response to the data request should consist of a sequence of
 * NDJSON-encoded objects:
 * *   header object - contains these properties:
 *     *   `count` **integer** - count of data objects
 *     *   `update` **boolean** - (optional) if true, data objects in
 *         response update previously loaded data; otherwise, the data
 *         objects replace previously loaded data in its entirety
 *     *   `timestamps` **object** - (optional) dependency timestamps
 *     *   `cutoff` **integer** - (optional) cutoff timestamp
 * *   data objects - zero or more data objects; each is coded as a
 *     two-element array containing these entries:
 *     *   key - object identifier
 *     *   object - the data object itself; `null` if the response is an
 *         update and the object has been deleted
 *
 * If the data service cannot serve the request in a timely fashion
 * (such that there is a risk of the request timing out), it may return
 * a "retry" response containing only a header object, with no `count`
 * property. The loader detects this response and retries the request.
 *
 * #### Data processing function
 *
 * The loader is configured with a `processor` function to store or
 * otherwise transform the loaded data. It has the signature:
 *     processor(objects, header)
 *
 * It is passed these parameters:
 * *   `objects` **ReadableStream** - a stream that returns the loaded
 *     data objects; each object is a two-element array containing the
 *     object identifier and the object itself (that is, the decoded
 *     NDJSON rows from the response)
 * *   `header` **Object** - the decoded header object from the response
 *
 * @param {Object} options - configuration options:
 * *   `name` **string** - name for error and activity reporting
 * *   `url` **string** - data source URL
 * *   `query` **Object** - query parameters for data request
 * *   `serialization` **Object** - serialization object; should define
 *     a `wrapEntity(entity)` method used to deserialize loaded data
 *     objects
 * *   `processor` **Function** - data processing function
 * *   `activityTarget` **Element** - target element for activity events
 * *   `activityEvent` - `CustomEvent` name for activity reporting
 */
class StreamedDataLoader {

  constructor(options) {
    this._config = {query: {}, serialization: nullSerialization, ...options}
    this.state = unloadedStateBit
    this._requestState = 'idle' // idle, pending, active
    this._requestDelay = 0
    this._timestamps = {}
    this._cutoff = 0
    this._pooledDataRequest = new PooledDataRequest(pick(this._config, ['name', 'activityTarget', 'activityEvent']))
    this._delayedDataRequest(0)
  }

  destroy() {
    if (this._pooledDataRequest) {
      this._pooledDataRequest.destroy()
      delete this._pooledDataRequest
    }
  }

  _delayedDataRequest(delay) {
    if ((this._requestState === 'pending') && (delay < this._requestDelay)) {
      clearTimeout(this._requestId)
      this._requestState = 'idle'
      delete this._requestId
    }
    if (this._requestState === 'idle') {
      this._requestState = 'pending'
      this._requestDelay = delay
      this._requestId = setTimeout(() => {
        delete this._requestId
        this._requestDelay = 0
        this._dataRequest()
      }, this._requestDelay)
    }
  }

  _dataRequest() {
    this._requestState = 'active'
    let params = {...this._config.query, timestamps: this._timestamps, cutoff: this._cutoff}
    return this._pooledDataRequest.queueDataRequest({url: this._config.url, params})
      .then(response => ndjsonStream(response.body))
      .then(stream => {
        let receivedData = false
        this._getHeaderObject(stream)
          .then(header => {
            this.state = this.state & ~errorStateBit
            if (header.hasOwnProperty('count')) {
              receivedData = true
              Object.assign(this._timestamps, header.timestamps)
              this._cutoff = header.cutoff
              return this._config.processor(stream, header)
            }
          })
          .then(() => {
            this._pooledDataRequest.releaseDataRequest()
            this._requestState = 'idle'
            if (receivedData) {
              this.state = this.state & ~unloadedStateBit
              this._pooledDataRequest.updateDataRequestActivity({activity: ''})
            }
            else {
              this.state |= unloadedStateBit
              this._pooledDataRequest.updateDataRequestActivity({activity: 'loading data'})
              this._delayedDataRequest(0)
            }
          })
      })
      .catch(error => {
        if (this._pooledDataRequest) { // destroy() deletes _pooledDataRequest
          this._pooledDataRequest.releaseDataRequest()
          this._requestState = 'idle'
          console.log('streamed-data-loader data request failed: ' + error.message)
          this.state |= errorStateBit
          this._pooledDataRequest.updateDataRequestActivity({activity: ''})
          this._delayedDataRequest(errorDelay)
        }
      })
  }

  _getHeaderObject(stream) {
    let reader = stream.getReader()
    return reader.read()
      .then(rslt => {
        reader.releaseLock()
        return rslt.value
      })
  }

  updateDataRequestActivity(value) {
    let clauses = []
    // suppress activity reporting once data is loaded
    if ((this.state !== 0) && value.activity) clauses.push(value.activity)
    // augment activity with error state
    if (this.state & errorStateBit) {
      clauses.push('loading failed')
      value.severity = 'error'
    }
    value.activity = clauses.join(', ')
    return super.updateDataRequestActivity(value)
  }

}


/** Streamed Data Loader Element.
 *
 * This is organized as a "helper" element that handles the low-level
 * work of loading data from an AJAX data source.
 *
 * The loader element attempts to share its data loader with other
 * elements requiring a compatibly configured loader. (It uses the
 * `SharedDataLoader` class to do this.) For this to work, the
 * configuration options `name`, `url`, `query` and `activityEvent`
 * must be the same.
 */
class StreamedDataLoaderElement extends LitElement {

  constructor() {
    super()
    this.name = undefined
    this.processor = undefined
    this.url = undefined
    this.query = undefined
    this.activityEvent = undefined
    this._loader = undefined
  }

  static get properties() {
    return {
      /** Name.
       */
      name: {
        type: String },
      /** Data processor.
       */
      processor: {
        type: Function },
      /** URL of data source.
       */
      url: {
        type: String },
      /** Query parameters for data request.
       */
      query: {
        type: Object },
      /** Activity event name.
       */
      activityEvent: {
        type: String,
        attribute: 'activity-event' },

      /** Data unloaded/error state.
       */
      state: {
        type: Number }
    }
  }

  connectedCallback() {
    super.connectedCallback()
  }

  disconnectedCallback() {
    if (this._loader) {
      let deref = sharedDataLoaders.dereferenceDataLoader(this._loader, this.processor)
      delete this._loader
      if (!deref) throw new Error(`could not dereference data loader (${this.name})`)
    }
    super.disconnectedCallback()
  }

  firstUpdated(changedProperties) {
  }

  shouldUpdate(changedProperties) {
    this._shouldUpdateDataSource(changedProperties)
    super.shouldUpdate(changedProperties)
    return false
  }

  _shouldUpdateDataSource(changedProperties) {
    if (changedProperties.has('name') || changedProperties.has('processor') ||
        changedProperties.has('url') || changedProperties.has('query') ||
        changedProperties.has('activityEvent')) {
      if (this.processor && this.url && this.query) {
        if (this._loader) throw new Error(`cannot reconfigure loader (${this.name})`)
        let options = pick(this, ['name', 'url', 'query', 'activityEvent'])
        this._loader = sharedDataLoaders.referenceDataLoader(
          StreamedDataLoader, options, this.processor, this)
      }
    }
  }

}

customElements.define('streamed-data-loader', StreamedDataLoaderElement)

export {StreamedDataLoaderElement as default, StreamedDataLoader}
