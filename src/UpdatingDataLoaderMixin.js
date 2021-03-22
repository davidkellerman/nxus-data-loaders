'use strict'

import {dedupeMixin} from '@open-wc/dedupe-mixin'

import SharedEventSource from './SharedEventSource.js'


/** Updating data loader mixin.
 * Listens to an `EventSource` for status events that indicate changes
 * to the data loader's data source and triggers a data request when
 * changes occur.
 *
 * It is configured with the URL of the status event source and the
 * status event name. Conventionally, these are derived from the URL of
 * the data loader's data source – the status URL formed from a stem of
 * the data URL (presumably a root path of a data API) with `/status`
 * appended; the status name taken from the pathname of the data URL,
 * possibly with a distinguishing identifier appended.
 *
 * For example, a data source URL `https://data.site.org/api/entities`
 * might produce:
 * *   `https://data.site.org/api/status` - status event source URL
 * *   `/api/entities` - status event name
 * *   `/api/entities:5dcb3cb3b427b70043dfb9bb` - status event name with
 *     a qualifying identifier
 *
 * @param {Object} options - configuration options:
 * *   `statusURL` **string** - URL of the status event source
 * *   `statusEvent` **string** - status event name
 */
const UpdatingDataLoaderMixin = dedupeMixin((base) => class extends base {

  constructor(options) {
    super(options)
    if (this._config.statusURL && this._config.statusEvent) {
      let url = new URL(this._config.statusURL, new URL(this._config.url, document.location)),
          event = this._config.statusEvent
      this._statusEventSource = new SharedEventSource(url)
      this._boundStatusEventListener = this._statusEventListener.bind(this)
      this._statusEventSource.addListener(event, this._boundStatusEventListener)
      this._timestamps = {}
      this._cutoff = 0
    }
  }

  destroy() {
    delete this._statusEventData
    this._removeStatusEventListener()
    super.destroy()
  }

  _dataRequest() {
    return super._dataRequest()
      .then(() => { this._queueDataRequestIfChanges() })
  }

  _statusEventListener(e) {
    this._statusEventData = JSON.parse(e.data)
    this._queueDataRequestIfChanges()
  }

  _removeStatusEventListener() {
    if (this._statusEventSource) {
      let event = this._config.statusEvent
      this._statusEventSource.removeListener(event, this._boundStatusEventListener)
    }
  }

  _queueDataRequestIfChanges() {
    let changed = false
    if ((this._requestState === 'idle') && this._statusEventData) {
      let superseded = this._statusEventData.superseded
      if (superseded) {
        for (let name in superseded) {
          if (superseded[name] > (this._timestamps[name] || 0)) {
            changed = true
            break
          }
        }
      }
      delete this._statusEventData
    }
    if (changed) this._delayedDataRequest(0)
  }

})


const UpdatingDataLoaderElementMixin = dedupeMixin((base) => class extends base {

  constructor() {
    super()
    this._statusURL = undefined
    this._statusEvent = undefined
  }

  static get properties() {
    return {
      /** URL of status EventSource.
       */
      statusURL: {
        type: String,
        attribute: 'status-url' },
      /* Status event.
       */
      statusEvent: {
        type: String,
        attribute: 'status-event' }
    }
  }

})

export {UpdatingDataLoaderMixin as default, UpdatingDataLoaderElementMixin}
