'use strict'

let sharedEventSources = {}

/** Shared EventSource objects.
 */
class SharedEventSource {

  constructor(url, options) {
    options = Object.assign({withCredentials: true}, options)
    if (sharedEventSources[url]) return sharedEventSources[url]
    sharedEventSources[url] = this
    this.__eventSource = new EventSource(url, options)
    this._eventListeners = {}
    this._open = false
    this.__eventSource.addEventListener('open', this._openListener.bind(this))
  }

  get eventSource() {
    return this.__eventSource
  }

  /** Adds event listener, disallowing multiple listeners.
   * @param {string} event - event name
   * @param {Function} listener - event listener
   */
  addListener(event, listener) {
    if (!this._eventListeners[event]) this._eventListeners[event] = new Set()
    if (this._eventListeners[event].has(listener))
      throw new Error(`attempt to add status event listener when already assigned (${event})`)
    this._eventListeners[event].add(listener)
    this.__eventSource.addEventListener(event, listener)
  }

  /** Removes event listener.
   * @param {string} event - event name
   * @param {Function} listener - event listener
   */
  removeListener(event, listener) {
    if (!this._eventListeners[event] || !this._eventListeners[event].has(listener))
      throw new Error(`attempt to remove status event listener when not assigned (${event})`)
    this.__eventSource.removeEventListener(event, listener)
    this._eventListeners[event].delete(listener)
    if (this._eventListeners[event].size === 0) delete this._eventListeners[event]
  }

  _openListener(e) {
    if (this._open) {
      // reopen event; kick event listeners
      let data = JSON.stringify({superseded: {reopen: 1}})
      for (let event in this._eventListeners) {
        let reopenEvent = new MessageEvent(event, {data})
        this.__eventSource.dispatchEvent(reopenEvent)
      }
    }
    this._open = true
  }

}

export {SharedEventSource as default}
