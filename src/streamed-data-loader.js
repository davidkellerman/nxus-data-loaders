'use strict'

/* eslint new-cap: ["warn", { "capIsNewExceptions": ["PooledDataRequestMixin"] }] */

import {LitElement} from 'lit-element'
import ndjsonStream from "can-ndjson-stream"

import PooledDataRequestMixin from './PooledDataRequestMixin.js'

const errorDelay = 60 * 1000

const unloadedStateBit = 1
const errorStateBit = 2

/** Streamed Data Loader Element.
 *
 * This is organized as a "helper" element that handles the low-level
 * work of loading data from an AJAX data source.
 *
 * It doesn't maintain any local reference to the loaded data (in part
 * because the data may be large). Instead, it passes loaded data to a
 * data processing function to transform or store it.
 *
 * ###### Response format
 *
 * The response to the data request consists of a sequence of
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
 * ###### Data processing function
 *
 * The loader is configured with a `processor` function to store or
 * otherwise transform the loaded data. It has the signature:
 *     ```
 *     processor(objects, update)
 *     ```
 * It is passed these parameters:
 * *   `objects` **object** - an associative array containing the
 *     loaded data objects; keys are assigned from the key entry of the
 *     response data; deleted object have an `undefined` value
 * *   `update` **boolean** - `true` if the data is an update.
 *
 */
class StreamedDataLoader extends PooledDataRequestMixin(LitElement) {

  constructor() {
    super()
    this.url = ''
    this.query = {}
    this.name = 'data-request'
    this.activityEvent = 'activity-changed'
    this.state = unloadedStateBit
    this._requestState = 'idle' // idle, pending, active
    this._requestDelay = 0
    this._timestamps = {}
    this._cutoff = 0
  }

  static get properties() {
    return {
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

      /** Data request name (for display purposes).
       */
      name: {
        type: String },
      /** Event for reporting data request activity.
       * The event `detail` will contain `name` and `status` properties.
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

  shouldUpdate(changedProperties) {
    if (changedProperties.has('processor') || changedProperties.has('url') || changedProperties.has('query'))
      this._dataSourceChange()
    super.shouldUpdate(changedProperties)
    return false
  }

  _dataSourceChange() {
    if (this.processor && this.url && this.query) {
      this._timestamps = {}
      this._cutoff = 0
      this._delayedDataRequest(0)
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
    let params = {...this.query, timestamps: this._timestamps, cutoff: this._cutoff}
    return this.queueDataRequest({url: this.url, params})
      .then(response => ndjsonStream(response.body))
      .then(stream => {
        let reader = stream.getReader(),
            update, count
        this._getResponseObject(reader)
          .then(rslt => {
            update = rslt.update
            count = rslt.count
            if (rslt.timestamps) Object.assign(this._timestamps, rslt.timestamps)
            if (rslt.cutoff) this._cutoff = rslt.cutoff
            this.state = this.state & ~errorStateBit
            return this._processResponseObjects(reader)
          })
          .then(entities => {
            this.releaseDataRequest()
            this._requestState = 'idle'
            if (entities) {
              this.processor(entities, update)
              this.state = this.state & ~unloadedStateBit
              this.updateDataRequestActivity({activity: ''})
            }
            else {
              this.state |= unloadedStateBit
              this.updateDataRequestActivity({activity: 'loading data'})
              this._delayedDataRequest(0)
            }
          })
      })
      .catch(error => {
        this.releaseDataRequest()
        this._requestState = 'idle'
        console.log('streamed-data-loader data request failed: ' + error.message)
        this.state |= errorStateBit
        this.updateDataRequestActivity({activity: ''})
        this._delayedDataRequest(errorDelay)
      })
  }

  _getResponseObject(reader) {
    return reader.read().then(rslt => rslt.value)
  }

  _processResponseObjects(reader) {
    return new Promise((resolve, reject) => {
      let entities = {}
      const processObject = rslt => {
        if (rslt.done)
          resolve(entities)
        else {
          let [key, entity] = rslt.value
          entities[key] = (entity == null) ? undefined : entity
          return reader.read().then(processObject)
        }
      }
      reader.read().then(processObject)
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

customElements.define('streamed-data-loader', StreamedDataLoader)

export {StreamedDataLoader as default}
