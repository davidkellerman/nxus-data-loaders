'use strict'

import {dedupeMixin} from '@open-wc/dedupe-mixin'
import isEqual from 'lodash/isEqual'


/* Pooled Fetch Requests.
 * Queues fetch() requests so as to limit the number of concurrently
 * active requests. Intended for use in browser contexts, where
 * sockets are a limited resource.
 *
 * Requests are grouped into "pools," with an upper limit on active
 * requests for each pool (2 by default).
 *
 * Each `PooledRequest` instance has a `promise` property. If the
 * fetch() request is successful, it resolves with the response object;
 * if the request fails or is canceled, it rejects with an `Error`
 * object.
 *
 * @private
 * @param {Element} context - HTML Element that incorporates the
 *   `PooledDataRequestMixin`; its `updateDataRequestActivity()` method
 *    is used to report request state changes
 * @param {Object} options - (optional) configuration options:
 * *   `url` - the url to which the request is sent
 * *   `params` - object sent as the request body
 * *   `pool` - (optional; default is `default`) request pool
 */
class PooledRequest {

  constructor(context, options) {
    this.context = context
    Object.assign(this, {pool: 'default', ...options})
    this.state = ''
    this.promise = new Promise((resolve, reject) => {
      this.__resolve = resolve
      this.__reject = reject
    })
  }

  enqueue() {
    if (this.state) throw new Error(`invalid attempt to enqueue pooled request (state ${this.state})`)
    let pool = PooledRequest.getPool(this.pool)
    pool.queued.push(this)
    this._updateState('queueud')
    PooledRequest.startPool(this.pool)
  }

  dequeue() {
    // remove all references, regardless of state
    let pool = PooledRequest.getPool(this.pool)
    let idx = pool.queued.indexOf(this)
    if (idx >= 0) pool.queued.splice(idx, 1)
    pool.active.delete(this)
    PooledRequest.startPool(this.pool)
  }

  _updateState(state) {
    this.state = state
    this.context.updateDataRequestActivity({activity: state})
  }

  _start() {
    let url = new URL(this.url, document.location),
        controller = this.__controller = new AbortController(),
        init = {
          method: 'POST',
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(this.params),
          signal: controller.signal }
    fetch(url, init)
      .then(
        (response) => {
          if (response.ok)
            this.__resolve(response)
          else {
            let error = new Error(`Data loading failed (${response.status}, ${response.statusText})`)
            console.log(error.message)
            this.__reject(error)
          }
        },
        (err) => { this.__reject(err) })
  }

  cancel() {
    if (this.__controller)
      this.__controller.abort() // should eventually reject
    else
      this.__reject(new Error('canceled'))
  }

  static getPool(name, options) {
    let pools = this.pools || (this.pools = {}),
        pool = pools[name]
    options = {limit: 2, ...options}
    if (!pool)
      pool = pools[name] = { limit: options.limit, queued: [], active: new Set() }
    return pool
  }

  static startPool(name) {
    let pool = this.getPool(name)
    if ((pool.queued.length > 0) && (pool.limit > pool.active.size)) {
      let request = pool.queued.shift()
      pool.active.add(request)
      request._updateState('active')
      request._start()
    }
  }

}


/** Data request mixin.
 *
 * Coded as a mixin so that it can use the element context to dispatch
 * activity events. This also means it defers data requests until the
 * element is connected and cancels any active requests when
 * disconnected.
 */
const PooledDataRequestMixin = dedupeMixin((base) => class extends base {

  constructor() {
    super()
    this.activityEvent = 'activity-changed'
    this.__dataRequest = undefined
    this.__dataRequestActivity = undefined
  }

  static get properties() {
    return {
      /* Activity event.
       */
      activityEvent: {
        type: String,
        attribute: 'activity-event' }
    }
  }

  connectedCallback() {
    super.connectedCallback()
    this._startDataRequest()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this.__dataRequest) this.__dataRequest.cancel()
  }

  /** Queues a data request for processing.
   *
   * Currently, requests use the POST method, include credentials, and
   * have a JSON-encoded body.
   *
   * @param {Object} options - data request object; has these properties:
   * *   `url` - the url to which the request is sent
   * *   `params` - object sent as the request body
   * @return {Promise} resolves with the request response object when
   *   the request succeeds; or rejects with failure status
   */
  queueDataRequest(options) { // {url, params}
    if (this.__dataRequest) throw new Error(`attempt to queue request when already active (${this.name || 'data'})`)
    let request = this.__dataRequest = new PooledRequest(this, options)
    this._startDataRequest()
    return request.promise
  }

  /** Releases completed data request.
   */
  releaseDataRequest() {
    if (this.__dataRequest) {
      this.__dataRequest.dequeue()
      this.updateDataRequestActivity({})
      this.__dataRequest = undefined
    }
  }

  _startDataRequest() {
    if (this.__dataRequest && this.isConnected) {
      let request = this.__dataRequest
      request.promise.catch((error) => { this.releaseDataRequest() })
      request.enqueue()
    }
  }

  /** Updates data request activity state.
   * Dispatches an activity event (if `activityEvent` is defined).
   *
   * Activity state is updated when the data request is queued for
   * processing, when it becomes active, and when it is released on
   * completion. Client code may report other state changes, such as
   * intermediate activity states.
   *
   * Override to implement other activity handling strategies.
   *
   * @param {Object} value - object describing activity; undefined
   *   if inactive
   */
  updateDataRequestActivity(value) {
    if (!isEqual(value, this.__dataRequestActivity)) {
      this.__dataRequestActivity = value
      if (this.activityEvent)
        this.dispatchEvent(new CustomEvent(this.activityEvent,
          {bubbles: true, composed: true,
            detail: {name: this.name || 'data', ...value}}))
    }
  }

})

export {PooledDataRequestMixin as default}
