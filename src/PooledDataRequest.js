'use strict'

import isEqual from 'lodash/isEqual'


/* Pooled Fetch Requests.
 * Queues fetch() requests so as to limit the number of concurrently
 * active requests. Intended for use in browser contexts, where sockets
 * are a limited resource.
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
 * @param {PooledDataRequests} context - request context
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


/** Pooled Data Request context.
 *
 * #### Request activity state
 *
 * Requests have an activity state. The state is updated when the data
 * request is queued for processing, when it becomes active, and when it
 * is released on completion. Client code may report other state
 * changes, such as intermediate activity states, using the
 * `updateDataRequestActivity()` method.
 *
 * Request handling emits events to report changes in activity state.
 * These `CustomEvent` instances have a `detail` property containing:
 * *   `name` - request name
 * *   `activity` - activity state.
 * *   `...` - client code may supply additional subproperties
 *
 * @param {Object} options - configuration options:
 * *   `name` **string** - request name for error and activity reporting
 * *   `activityTarget` **Element** - target element for activity events
 * *   `activityEvent` - `CustomEvent` name for activity reporting;
 *     default is `activity-changed`
 *
 */
class PooledDataRequest {

  constructor(options) {
    this._config = {name: 'data-request', activityEvent: 'activity-changed', ...options}
    this._dataRequest = undefined
    this._dataRequestActivity = undefined
  }

  destroy() {
    if (this._dataRequest) {
      this._dataRequest.cancel()
      delete this._dataRequest
    }
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
    if (this._dataRequest) throw new Error(`attempt to queue request when already active (${this._config.name})`)
    let request = this._dataRequest = new PooledRequest(this, options)
    this._startDataRequest()
    return request.promise
  }

  /** Releases completed data request.
   */
  releaseDataRequest() {
    if (this._dataRequest) {
      this._dataRequest.dequeue()
      this.updateDataRequestActivity({})
      this._dataRequest = undefined
    }
  }

  _startDataRequest() {
    let request = this._dataRequest
    if (request) {
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
    if (!isEqual(value, this._dataRequestActivity)) {
      this._dataRequestActivity = value
      if (this._config.activityTarget) {
        let event = new CustomEvent(this._config.activityEvent,
          {bubbles: true, composed: true,
            detail: {name: this._config.name || 'data', ...value}})
        this._config.activityTarget.dispatchEvent(event)
      }
    }
  }

}

export {PooledDataRequest as default}
