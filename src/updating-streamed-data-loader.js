'use strict'

/* eslint new-cap: ["warn", { "capIsNewExceptions": ["UpdatingDataLoaderMixin", "UpdatingDataLoaderElementMixin"] }] */

import pick from 'lodash/pick'

import {sharedDataLoaders} from './SharedDataLoaders.js'
import {default as UpdatingDataLoaderMixin, UpdatingDataLoaderElementMixin} from './UpdatingDataLoaderMixin.js'
import {default as StreamedDataLoaderElement, StreamedDataLoader} from './streamed-data-loader.js'

/** Updating Streamed Data Loader.
 * @extends StreamedDataLoader
 * @extends UpdatingDataLoaderMixin
 */
class UpdatingStreamedDataLoader extends UpdatingDataLoaderMixin(StreamedDataLoader) {
  constructor(options) {
    super(options)
  }
}

/** Updating Streamed Data Loader Element.
 * Extends `StreamedDataLoaderElement` to provide a streamed data loader
 * that responds to change events.
 *
 * @extends StreamedDataLoaderElement
 */
class UpdatingStreamedDataLoaderElement extends UpdatingDataLoaderElementMixin(StreamedDataLoaderElement) {

  constructor() {
    super()
  }

  _shouldUpdateDataSource(changedProperties) {
    if (changedProperties.has('name') || changedProperties.has('processor') ||
        changedProperties.has('url') || changedProperties.has('query') ||
        changedProperties.has('statusURL') || changedProperties.has('statusEvent') ||
        changedProperties.has('activityEvent')) {
      if (this.processor && this.url && this.query && this.statusURL && this.statusEvent) {
        if (this._loader) throw new Error(`cannot reconfigure loader (${this.name})`)
        let options = pick(this, ['name', 'url', 'query', 'statusURL', 'statusEvent', 'activityEvent'])
        this._loader = sharedDataLoaders.referenceDataLoader(
          UpdatingStreamedDataLoader, options, this.processor, this)
      }
    }
  }

}

customElements.define('updating-streamed-data-loader', UpdatingStreamedDataLoaderElement)

export {UpdatingStreamedDataLoaderElement as default, UpdatingStreamedDataLoader}
