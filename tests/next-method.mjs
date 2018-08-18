import test from "ava"
import Stream from "../Stream.mjs"

test('next resolves with values that have already been enqueued', async t => {
    const s = new Stream(stream => {
        stream.yield(10)
        stream.yield(20)
    })
    t.deepEqual({ done: false, value: 10 }, await s.next())
    t.deepEqual({ done: false, value: 20 }, await s.next())
})

test("next resolves with values that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    // Let a microtask happen
    await null
    streamController.yield(11)
    streamController.yield(23)

    t.deepEqual({ done: false, value: 11 }, await one)
    t.deepEqual({ done: false, value: 23 }, await two)
})

test("next method receives done values and only done: true after that", async t => {
    const s = new Stream(stream => {
        stream.yield(111)
        stream.return(37)
        stream.yield(12)
        stream.throw('Whoopsie')
    })
    t.deepEqual({ done: false, value: 111 }, await s.next())
    t.deepEqual({ done: true, value: 37 }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("next method receives done values that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    const three = s.next()
    const four = s.next()
    // Let a microtask happen
    await null
    streamController.yield(11)
    streamController.return(23)
    streamController.yield(12)
    streamController.throw('Whoopsies')

    t.deepEqual({ done: false, value: 11 }, await one)
    t.deepEqual({ done: true, value: 23 }, await two)
    t.deepEqual({ done: true, value: undefined }, await three)
    t.deepEqual({ done: true, value: undefined }, await four)
})

test("next method receives exceptions as rejections", async t => {
    const s = new Stream(stream => {
        stream.yield(11)
        stream.throw(new Error('Whoopsies'))
        stream.yield(23)
        stream.throw('Oopsies again')
        stream.return("This shouldn't be observed")
    })

    t.deepEqual({ done: false, value: 11 }, await s.next())
    const error = await t.throwsAsync(_ => s.next())
    t.is(error.message, 'Whoopsies')
    t.deepEqual({ done: true, value: undefined }, await s.next())
    t.deepEqual({ done: true, value: undefined }, await s.next())
})

test("next method receives exceptions as rejections that haven't been received yet", async t => {
    let streamController
    const s = new Stream(stream => {
        streamController = stream
    })

    const one = s.next()
    const two = s.next()
    const three = s.next()
    const four = s.next()

    streamController.yield(11)
    streamController.throw(new Error('Whoopsies'))
    streamController.yield(23)
    streamController.throw(new Error('Oopsies again'))
    streamController.return(new Error("This shouldn't be observed"))

    t.deepEqual({ done: false, value: 11 }, await one)
    const error = await t.throwsAsync(_ => two)
    t.is(error.message, 'Whoopsies')
    t.deepEqual({ done: true, value: undefined }, await three)
    t.deepEqual({ done: true, value: undefined }, await four)
})
