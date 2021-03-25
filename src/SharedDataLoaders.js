'use strict'

import objectHash from 'object-hash'

class StreamForwarder {
  constructor() {
    this.stream = new ReadableStream({
      start: (controller) => { this._controller = controller }
    })
  }
  forward(rslt) {
    if (rslt.done)
      this._controller.close()
    else
      this._controller.enqueue(rslt.value)
  }
}

class EventForwarder {
  constructor(spec) {
    this._spec = spec
  }
  dispatchEvent(event) {
    for (let target of this._spec.targets.keys()) {
      let e = new CustomEvent(event.type,
        {bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed, detail: event.detail})
      target.dispatchEvent(e)
    }
  }
}


/** Shared DataLoader objects.
 * Rather than having multiple instances of identically configured data
 * loaders, this class allows a single loader instance to be shared
 * among multiple clients. The benefit being that data is loaded only
 * once, then distributed to the multiple clients.
 *
 * A data loader is uniquely identified by:
 * *   `DataLoader` subclass
 * *   data source URL
 * *   data request query parameters
 * *   serialization object
 */
class SharedDataLoaders {

  constructor() {
    this._dataLoaders = new Map()
  }

  /** Adds data loader reference.
   * If shared data loader matching the required configuration is
   * already defined, refer to it; otherwise, create a new shared data
   * loader with the specified configuration.
   *
   * @param {Class} Subclass - data loader subclass
   * @param {Object} config - data loader configuration (passed to the
   *   data loader subclass constructor)
   * @param {Function} processor - data processor
   * @param {Element} target - target element for activity events
   * @return {Object} data loader instance
   */
  referenceDataLoader(Subclass, config, processor, target) {
    let loaders = this._dataLoaders.get(Subclass)
    if (!loaders) this._dataLoaders.set(Subclass, loaders = new Map())
    let hash = objectHash(config),
        spec = loaders.get(hash)
    if (!spec) {
      spec = {config, processors: new Set(), targets: new Map(),
        objects: new Map(), state: '', catchups: new Set() }
      spec.loader = new Subclass({...config,
        processor: this._sharedProcessor.bind(this, spec),
        activityTarget: new EventForwarder(spec) })
      loaders.set(hash, spec)
    }
    spec.processors.add(processor)
    if (target) {
      let ref = spec.targets.get(target)
      if (!ref) spec.targets.set(target, ref = {count: 0})
      ref.count += 1
    }
    if (spec.state) {
      spec.catchups.add(processor)
      if (spec.state === 'loaded') this._delayedCatchup(spec)
    }
    return spec.loader
  }

  /** Removes data loader reference.
   * @param {Object} loader - data loader instance (returned by
   *   `referenceDataLoaders()`)
   * @param {Function} processor - data processor
   * @param {Element} target - target element for activity events
   * @return {boolean} true if reference removed; false if no matching
   *   loader and reference were present
   */
  dereferenceDataLoader(loader, processor, target) {
    let deleted = false,
        loaders = this._dataLoaders.get(loader.constructor)
    if (loaders) {
      let hash, spec
      for (let [h, s] of loaders)
        if (s.loader === loader) { hash = h; spec = s; break }
      if (spec && spec.processors.has(processor)) {
        deleted = true
        spec.processors.delete(processor)
        if (target) {
          let ref = spec.targets.get(target)
          if (ref) {
            ref.count -= 1
            if (ref.count === 0) spec.targets.delete(target)
          }
        }
        if (spec.processors.size === 0) {
          if (spec.loader.destroy) spec.loader.destroy()
          loaders.delete(hash)
        }
      }
    }
    return deleted
  }

  async _sharedProcessor(spec, stream, header) {
    spec.state = 'loading'
    spec.header = header
    if (!header.update) spec.objects.clear()
    let forwarders = []
    for (let processor of spec.processors) {
      let fwd = new StreamForwarder()
      forwarders.push(fwd)
      processor(fwd.stream, header)
    }
    let reader = stream.getReader(), rslt
    for (;;) {
      rslt = await reader.read()
      for (let fwd of forwarders)
        fwd.forward(rslt)
      if (rslt.done) break
      let [key, obj] = rslt.value
      if (obj) spec.objects.set(key, obj); else delete spec.objects.delete(key)
    }
    spec.state = 'loaded'
    if (spec.catchups.size > 0) this._delayedCatchup(spec)
  }

  _delayedCatchup(spec) {
    spec._catchupId = setTimeout(() => {
      delete spec._catchupId
      if (spec.state === 'loaded') {
console.log('YAY, CATCHUPS!')
        this._catchupProcessor(spec)
      }
    }, 0)
  }

  _catchupProcessor(spec) {
    let forwarders = []
    for (let processor of spec.catchups) {
      let fwd = new StreamForwarder()
      forwarders.push(fwd)
      processor(fwd.stream, spec.header)
    }
    spec.catchups.clear()
    let rslt
    for (let value of spec.objects) {
      rslt = {done: false, value}
      for (let fwd of forwarders)
        fwd.forward(rslt)
    }
    rslt = {done: true}
    for (let fwd of forwarders)
      fwd.forward(rslt)
  }

}

let sharedDataLoaders = new SharedDataLoaders()

export {SharedDataLoaders as default, sharedDataLoaders}
