
# Stream

### Introduction

Soon JavaScript will be getting [asynchronous iterators and asychronous generators](https://github.com/tc39/proposal-async-iteration), however the proposal doesn't include any way for creating an asynchronous sequence from existing asynchronous operations.

This library intends to fill that void by providing a single concrete type which has large similarties to the Promise type, it also borrows ideas from the [obervable proposal](https://github.com/tc39/proposal-observable) in its minimal API design and use of an observer object.

*NOTE: Like the Observable proposal the goal of Stream is to have minimal API surface which is why Stream does't include any operators such as `.map`/`.filter`/etc, those should provided by some other library*

### API

#### `stream` Objects

Objects referred to here as "streams" are those objects returned by the `Stream` constructor, the purpose of a Stream object is to behave as an async iterable for some asynchronous collection (e.g. clicks on an element, ticks on a clock, etc).


#### `new Stream(initializer: function, { queue: number=Infinity }={})`

The `Stream` constructor requires a single parameter as it's first argument, the initializer will be called immediately with a `StreamController` object (see later), it may optionally return a single function that will be called to cleanup any resources the stream may hold (guaranteed to be called only once).

The second argument is an options object which currently only accepts a single property `queue` which is simply a non-negative integer that indicates how many items will be kept in the queue that haven't yet been consumed before the queue starts dropping the oldest items in the queue (e.g. if the queue length is 1 then if 10 items are emitted before any are consumed then only the last can be observed).


#### `Stream.prototype.next(): Promise<{ done: boolean, value: any }, any>`

The `.next` method of stream objects simply waits until the next value of the stream is emitted (which may be already queued if calling later than the value was emitted), if the stream yields a value normally then this will be `{ done: false, value: ...}`, otherwise if the stream completes then once the value will be  `{ done: true, value: ... }`, if the stream throws an error then the Promise will reject with the error thrown by the stream.

The `.next` is designed to be safe to call multiple times in advance in which case the returned Promises will resolve as if they were immediately added after the previous one resolved. If a stream finishes before all requested `.next` are resolved then any after the `{ done: true }` or error value will simply be the object `{ done: true, value: undefined }`.

*NOTE: If an error occurs during cleanup then the Promise returned from `.next` will reject with the cleanup error instead of the return value, this will even override any thrown error in the Stream*


#### `Stream.prototype.return(): Promise<{ done: true, value: any }, any>`

The `.return` method will cause the cleanup action to be invoked immediately (if it hasn't already) and then return `{ done: true, value: undefined }` upon successful completion of the the cleanup action.

If any Promises returned by previous calls to `.next` are still not resolved then `.return` will wait until their requests will be honored and the `.return` method won't trigger cleanup until the most recent Promise returned by `.next` is resolved.

*NOTE: If an error occurs during cleanup then the Promise returned from `.return` will reject with the cleanup error instead of the value `{ done: true, value: undefined }`*


#### `Stream.prototype[Symbol.asyncIterator](): Stream`

Because streams are already valid async iterators the return value of `[Symbol.asyncIterator]` is simply the stream on which the method was invoked.


#### `StreamController`

The StreamController object is an object passed into the initializer, this the mechanism by which you can cause the stream to emit new values or complete, it only has three methods (plus three aliases which enable interoperability with Observables if desired).

*NOTE: All of the StreamController methods will simply do nothing if the Stream has been closed (by either calling `.return` or `.throw` on the StreamController or by calling `.return` on the stream itself).

*NOTE: All of the StreamController methods are bound to the stream instance so you don't need to bind them yourself unlike in Observable!*


#### `StreamController.yield(value: any)`/`StreamController.next(value: any)`

The `.yield` function on the stream controller will cause the oldest unfufilled Promise requested by `.next` to resolve with the `value` field set to the value passed into the `.yield` function. If `.next` hasn't been requested yet then this will simply add a value into the queue that will be consumed instantly by subsequent `stream.next` calls.

*NOTE: Calling `.yield` after the stream has been ended will have no effect*

*NOTE: `.next` is simply an Observable compatible alias for `.yield`*


#### `StreamController.throw(error: any)`/`StreamController.error(error: any)`

The `.throw` function on the stream controller will cause the oldest unfulfilled Promise requested by `.next` to be rejected with the given error. If no `.next` is currently requested then the error will be queued and once all values currently in the queue are consumed the next `.next` call will reject with the passed error.

*NOTE: Calling `.throw` after the stream has ended will have no effect*

*NOTE: `.error` is simply an Observable compatible alias for `.throw`*


#### `StreamController.return(value: any)/`StreamConroller.complete(value: any)`

The `.return` function on the stream controller will cause the oldest unfufilled Promise requested by `.next` to return with the `value` field set to the passed value however unlike `.yield` it will also cause the `done` value to be set to `false` and cause the stream to complete. If the `.next` hasn't been requested yet then the return value will be queued until the queue is empty and `.next` is called again.

*NOTE: Calling `.return` after the stream has ended will have no effect*

*NOTE: `.complete` is simply an Observable compatible alias for `.return` however unlike Observable the value passed to `.return`/`.complete` is not simply ignored, when creating compatible definitions the value passed into `.return` must not be relied upon*


### Examples

Coming soon! Plus a blog post!
