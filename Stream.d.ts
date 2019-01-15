/// <reference lib="esnext"/>

declare global {
    interface SymbolConstructor {
        readonly cancelSignal: unique symbol
    }
}

interface CancelSubscription {
    unsubscribe(): void
}

interface CancelSignal {
    signaled: boolean
    subscribe(cb: () => void): CancelSubscription
}

interface Cancelable {
    [Symbol.cancelSignal](): CancelSignal
}

export interface StreamController<T, R> {
    yield(value: T): void
    return(value: R): void
    throw(value: any): void

    next(value: T): void
    return(value: R): void
    throw(value: any): void

    cancelSignal: Cancelable
}

export interface StreamInitializer<T, R> {
    (controller: StreamController<T, R>): undefined
    (controller: StreamController<T, R>): () => void
}

export interface StreamOptions {
    queue?: number
    cancelSignal?: Cancelable
}

export type IteratorResult<T, R>
    = { done: false, value: T }
    | { done: true, value: R }

export interface AsyncIterator<T, R> {
    next(): Promise<IteratorResult<T, R>>
    return?(value?: R): Promise<IteratorResult<T, R>>
}

export interface AsyncIterable<T, R> {
    [Symbol.asyncIterator](): AsyncIterator<T, R>
}

export type AsyncIterableIterator<T, R>
    = AsyncIterator<T, R>
    & AsyncIterable<T, R>

export default class Stream<T, R=void> implements AsyncIterableIterator<T, R> {
    constructor(initializer: StreamInitializer<T, R>, options?: StreamOptions)

    readonly cancelled: boolean

    next(): Promise<IteratorResult<T, R>>
    return(value: R): Promise<IteratorResult<T, R>>
    [Symbol.asyncIterator](): this
}