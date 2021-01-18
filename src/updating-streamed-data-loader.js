'use strict'

/* eslint new-cap: ["warn", { "capIsNewExceptions": ["UpdatingDataLoaderMixin"] }] */

import UpdatingDataLoaderMixin from './UpdatingDataLoaderMixin.js'
import StreamedDataLoader from './streamed-data-loader.js'


/** Updating Streamed Data Loader Element.
 * Extends `StreamedDataLoader` with `UpdatingDataLoaderMixin` to
 * provide a streamed data loader that responds to change events.
 *
 * @extends StreamedDataLoader
 * @extends UpdatingDataLoaderMixin
 */
class UpdatingStreamedDataLoader extends UpdatingDataLoaderMixin(StreamedDataLoader) {
  constructor() {
    super()
  }
}

customElements.define('updating-streamed-data-loader', UpdatingStreamedDataLoader)

export {UpdatingStreamedDataLoader as default}
