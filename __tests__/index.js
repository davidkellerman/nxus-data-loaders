/**
 * Notes on tests:
 * *   Uses Electron for test context.
 *     *   Tried to use `jest-electron` as test runner, because it
 *         provided better debugging support and seemed better behaved
 *         than `@jest-runner/electron`. Unfortunately, it doesn't
 *         seem to be keeping up with new versions of electron or jest.
 *     *   `@jest-runner/electron` is no longer active.
 *     *   Switched to `@kayahr/jest-electron-runner`, which is a fork
 *         of `@jest-runner/electron`. Seems to work, but doesn't
 *         provide any sort of debugging support.
 *         See https://github.com/kayahr/jest-electron-runner/issues/14
 *     *   `jsdom` really isn't a viable test context; there are simply
 *         too many gaps in its implementations of DOM APIs.
 * *   Uses webpack to bundle files in preparation for testing.
 *     *   The distributed JavaScript files in the package use ES6
 *         module specifications. Spent considerable effort in
 *         unsuccessfully trying to handle dependency loading directly
 *         in Jest (Babel, etc.); pre-building a bundle seems to be the
 *         better approach.
 * *   Uses `fetch-mock` to mock `fetch()` requests.
 *     *   First tried `jest-fetch-mock`, which was a bad idea. Provides
 *         a deficient implementation of the fetch `Response` object.
 *         Also, the configuration hooks provided by `fetch-mock` seem
 *         easier to use.
 *     *   `fetch-mock-jest` wrapper that supposedly simplifies
 *         integration of `fetch-mock` with Jest doesn't seem to pick
 *         the right package version when used with Electron.
 */

/* globals jest: false, beforeAll: false, beforeEach: false, describe: false, it: false, expect: false */

'use strict'

import {default as EventSourceMock, sources as eventSources} from 'eventsourcemock'
Object.defineProperty(window, 'EventSource', {value: EventSourceMock})

import fetchMock from 'fetch-mock/es5/client'

import {SharedDataLoaders, DeserializingDataProcessor, DeserializingSingletonDataProcessor} from './dist/index-webpack.js'

const dateRE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{1,2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,})?Z$/

const responseCreatedAt = '2021-01-01T00:00:00.00Z'
const responseObjects = {
  '1': {
    what: 'ever',
    createdAt: expect.stringMatching(dateRE),
    updatedAt: expect.stringMatching(dateRE) }
}

let fetchDataMockTimestamp = Date.now()
let fetchDataMockKeyPrefixed = true
async function fetchDataMock(url, options, request) {
  const headers = {'Content-Type': 'application/x-ndjson'}
  let body = JSON.parse(options.body),
      timestamps = {test: fetchDataMockTimestamp},
      keyPrefix = fetchDataMockKeyPrefixed ? 'test' : ''
  return new Response(
    responseBody(responseObjects, {timestamps, cutoff: Date.now()}, keyPrefix),
    {status: 200, statusText: 'OK', headers})
}

function responseBody(objects, header, keyPrefix) {
  const encoder = new TextEncoder()
  const updatedAt = new Date(header.cutoff).toISOString()
  let rows = [], index = 0
  for (let [key, object] of Object.entries(objects)) {
    if (keyPrefix) key = keyPrefix + '.' + key
    rows.push([key, {...object, createdAt: responseCreatedAt, updatedAt} ])
  }
  rows.unshift({count: rows.length, ...header})
  return new ReadableStream({
    pull(controller) {
      if (index >= rows.length) {
        controller.close()
      }
      else {
        controller.enqueue(encoder.encode(JSON.stringify(rows[index]) + '\n'))
        index += 1
      }
    }
  })
}

class ResultPackage {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.assign = (val) => { resolve(val); return this.promise }
    })
  }
}
class DataProcessorContext {
  constructor(Processor, options) {
    this.results = []
    this.pendingResults = []
    this.processor = this._processor.bind(this)
    this._dataProcessor = new Processor(this, 'test', options)
  }
  nextResult() {
    let result = this.results.shift()
    if (!result) {
      result = new ResultPackage()
      this.pendingResults.push(result)
    }
    return result
  }
  assignResult(val) {
    let result = this.pendingResults.shift()
    if (!result) {
      result = new ResultPackage()
      this.results.push(result)
    }
    result.assign(val)
  }
  async _processor(stream, header) {
    let processor = this._dataProcessor.streamedDataProcessor
    await processor(stream, header)
    this.assignResult([this['test'], header])
  }
}

class MockLoader {
  constructor(options) {
    this._config = options
  }
  mockResponse(objects, header, keyPrefix) {
    let timestamps = {test: fetchDataMockTimestamp}
    header = {...header, timestamps, cutoff: Date.now()}
    const updatedAt = new Date(header.cutoff).toISOString()
    let rows = Object.entries(objects).map((entry) => {
          let key = entry[0]
          if (keyPrefix) key = keyPrefix + '.' + key
          return [key, {...entry[1], createdAt: responseCreatedAt, updatedAt} ]
        }),
        promise = Promise.resolve().then((resolve, reject) => {
          let index = 0,
              stream = new ReadableStream({
                pull(controller) {
                  if (index >= rows.length) {
                    controller.close()
                    resolve()
                  }
                  else {
                    controller.enqueue(rows[index])
                    index += 1
                  }
                }
              })
          this._config.processor(stream, header)
        })
    return promise
  }
}

const mockLoaderConfig = {url: '/data'}


const commonLoaderParams = {
  processor: (objects, update) => {},
  url: '/test/data',
  query: {},
  name: 'test-data-request',
  activityEvent: 'test-activity-changed'
}
const updatingLoaderParams = {
  statusURL: '/test/status',
  statusEvent: 'test/status'
}


// jest.setTimeout(1 * 60 * 1000)

describe('SharedDataLoaders class', () => {
  let shared, refs = []

  beforeAll(() => {
    shared = new SharedDataLoaders()
  })

  it('should instantiate', () => {
    expect(shared).not.toBeNull()
  })

  it('should process data loader references', () => {
    for (let i = 0; i < 2; i += 1) {
      let processorContext = new DataProcessorContext(DeserializingDataProcessor),
          loader = shared.referenceDataLoader(MockLoader, mockLoaderConfig, processorContext.processor, document)
      refs.push({loader, processorContext})
    }
    expect(refs[0].loader).toEqual(refs[1].loader)
    let specs = Array.from(shared._dataLoaders.get(MockLoader).values())
    expect(specs.length).toEqual(1)
    let spec = specs[0]
    expect(spec.config).toEqual(mockLoaderConfig)
    let processors = new Set(refs.map(ref => ref.processorContext.processor))
    expect(spec.processors).toEqual(processors)
  })

  it('should distribute loaded data', async () => {
    fetchDataMockKeyPrefixed = true
    let loader = refs[0].loader,
        promise = loader.mockResponse(responseObjects, {}, 'test')
    for (let ref of refs) {
      let result = ref.processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
    }
    await promise
  })

  it('should process data loader dereferences', () => {
    for (let ref of refs) {
      let deref = shared.dereferenceDataLoader(ref.loader, ref.processorContext.processor, document)
      expect(deref).toEqual(true)
    }
    let specs = Array.from(shared._dataLoaders.get(MockLoader))
    expect(specs.length).toEqual(0)
  })

})

describe('streamed-data-loader element', () => {
  let element, processorContext

  function createLoaderElement() {
    element = document.createElement('streamed-data-loader')
    for (let [key, param] of Object.entries(commonLoaderParams))
      element[key] = param
  }

  beforeAll(() => {
    let dataURL = new URL('/test/data', document.location)
    fetchMock.reset()
    fetchMock
      .post(dataURL, fetchDataMock)
      .catch(400)
  })

  describe('load', () => {
    it('should instantiate with createElement()', () => {
      createLoaderElement()
      expect(element).not.toBeNull()
    })
    it('should accept parameter settings', () => {
      for (let [key, param] of Object.entries(commonLoaderParams))
        expect(element[key]).toEqual(param)
    })
  })

  describe('data', () => {
    it('should load data with prefixed keys', async () => {
      createLoaderElement()
      fetchDataMockKeyPrefixed = true
      processorContext = new DataProcessorContext(DeserializingDataProcessor)
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
      element.remove()
    })
    it('should load data with unprefixed keys', async () => {
      createLoaderElement()
      fetchDataMockKeyPrefixed = false
      processorContext = new DataProcessorContext(DeserializingDataProcessor, {keyPrefix: ''})
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
      element.remove()
    })
    it('should load singleton data', async () => {
      createLoaderElement()
      fetchDataMockKeyPrefixed = true
      processorContext = new DataProcessorContext(DeserializingSingletonDataProcessor)
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [object, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(object).toEqual(responseObjects['1'])
      element.remove()
    })
  })

})

describe('updating-streamed-data-loader element', () => {
  let element, processorContext

  function createLoaderElement() {
    element = document.createElement('updating-streamed-data-loader')
    for (let [key, param] of Object.entries(commonLoaderParams))
      element[key] = param
    for (let [key, param] of Object.entries(updatingLoaderParams))
      element[key] = param
  }

  beforeAll(() => {
    let dataURL = new URL('/test/data', document.location)
    fetchMock.reset()
    fetchMock
      .post(dataURL, fetchDataMock)
      .catch(400)
  })

  describe('load', () => {
    it('should instantiate with createElement()', () => {
      createLoaderElement()
      expect(element).not.toBeNull()
    })
    it('should accept parameter settings', () => {
      for (let [key, param] of Object.entries(commonLoaderParams))
        expect(element[key]).toEqual(param)
      for (let [key, param] of Object.entries(updatingLoaderParams))
        expect(element[key]).toEqual(param)
    })
  })

  describe('data', () => {
    it('should load data', async () => {
      createLoaderElement()
      fetchDataMockKeyPrefixed = true
      processorContext = new DataProcessorContext(DeserializingDataProcessor)
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
    })
    it('should reload data in response to EventSource event', async () => {
      let statusURL = new URL('/test/status', document.location),
          src = eventSources[statusURL],
          now = fetchDataMockTimestamp = Date.now(),
          data = JSON.stringify({superseded: {test: now}}),
          event = new MessageEvent('test/status', {data})
      src.emit(event.type, event)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
      element.remove()
    })
    it('should load singleton data', async () => {
      createLoaderElement()
      fetchDataMockKeyPrefixed = true
      processorContext = new DataProcessorContext(DeserializingSingletonDataProcessor)
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [object, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(object).toEqual(responseObjects['1'])
    })
    it('should reload singleton data in response to EventSource event', async () => {
      let statusURL = new URL('/test/status', document.location),
          src = eventSources[statusURL],
          now = fetchDataMockTimestamp = Date.now(),
          data = JSON.stringify({superseded: {test: now}}),
          event = new MessageEvent('test/status', {data})
      src.emit(event.type, event)
      let result = processorContext.nextResult(),
          [object, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(object).toEqual(responseObjects['1'])
      element.remove()
    })
  })

})
