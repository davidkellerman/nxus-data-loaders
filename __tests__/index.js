/**
 * Notes on tests:
 * *   Uses Electron for test context.
 *     *   Tried to use `@jest-runner/electron`; it has more downloads
 *         and contributors than the alternate `jest-electron` package.
 *         However, couldn't get debugging to work in Electron
 *         environment. It ignores `debugger` statements placed in the
 *         code. Also, `console.log()` output isn't visible, nor are
 *         exceptions.
 *    *    Switched to `jest-electron`. It links agains an older version
 *         of Electron, but seems better behaved. Setting `DEBUG_MODE=1`
 *         provides a debugger console that's fairly functional.
 *         Also see https://github.com/hustcc/jest-electron/issues/33.
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

import {DeserializingEntityDataProcessor} from './dist/index-webpack.js'

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
  const updatedAt = new Date(header.cutoff)
  let rows = [], index = 0
  for (let [key, object] of Object.entries(objects)) {
    if (keyPrefix) key = keyPrefix + '.' + key
    rows.push([key, {...object, createdAt: responseCreatedAt, updatedAt}])
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
  constructor(options) {
    this.results = []
    this.pendingResults = []
    this.processor = this._processor.bind(this)
    this._dataProcessor = new DeserializingEntityDataProcessor(this, 'test', options)
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

describe('streamed-data-loader element', () => {
  let element, processorContext

  beforeAll(() => {
    let dataURL = new URL('/test/data', document.location)
    fetchMock.reset()
    fetchMock
      .post(dataURL, fetchDataMock)
      .catch(400)
    element = document.createElement('streamed-data-loader')
  })

  describe('load', () => {
    it('should instantiate with createElement()', () => {
      expect(element).not.toBeNull()
    })
    it('should accept parameter settings', () => {
      for (let [key, param] of Object.entries(commonLoaderParams)) {
        element[key] = param
        expect(element[key]).toEqual(param)
      }
    })
  })

  describe('data', () => {
    it('should load data with prefixed keys', async () => {
      fetchDataMockKeyPrefixed = true
      processorContext = new DataProcessorContext()
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
    })
  })

  describe('data', () => {
    it('should load data with unprefixed keys', async () => {
      fetchDataMockKeyPrefixed = false
      processorContext = new DataProcessorContext({keyPrefix: ''})
      element.processor = processorContext.processor
      document.body.appendChild(element)
      let result = processorContext.nextResult(),
          [objects, header] = await result.promise
      expect(header.update).toBeFalsy()
      expect(objects).toEqual(responseObjects)
    })
  })

})

describe('updating-streamed-data-loader element', () => {
  let element, processorContext

  beforeAll(() => {
    let dataURL = new URL('/test/data', document.location)
    fetchMock.reset()
    fetchMock
      .post(dataURL, fetchDataMock)
      .catch(400)
    element = document.createElement('updating-streamed-data-loader')
    fetchDataMockKeyPrefixed = true
    processorContext = new DataProcessorContext()
  })

  describe('load', () => {
    it('should instantiate with createElement()', () => {
      expect(element).not.toBeNull()
    })
    it('should accept parameter settings', () => {
      for (let [key, param] of Object.entries(commonLoaderParams)) {
        element[key] = param
        expect(element[key]).toEqual(param)
      }
      for (let [key, param] of Object.entries(updatingLoaderParams)) {
        element[key] = param
        expect(element[key]).toEqual(param)
      }
    })
  })

  describe('data', () => {
    it('should load data', async () => {
jest.setTimeout(60000)
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

    })
  })

})
