/// <reference lib="esnext" />
declare class Deferred<T> {
    private _resolve;
    private _reject;
    private _promise;
    constructor();
    readonly promise: Promise<T>;
    readonly resolver: {
        resolve: (value: T) => void;
        reject: (error: any) => void;
    };
}
interface AbstractQueue<T> {
    isEmpty: boolean;
    enqueue: (value: T) => any;
    dequeue: () => T;
}
export declare class Queue<T> implements AbstractQueue<T> {
    private _queue;
    readonly isEmpty: boolean;
    enqueue(value: T): void;
    dequeue(): T;
}
declare type CleanupCallback = () => any;
declare type StreamController<T> = {
    [Symbol.toStringTag]: string;
    yield: (value: T) => void;
    next: (value: T) => void;
    throw: (error?: any) => void;
    error: (error?: any) => void;
    return: (endValue?: any) => void;
    complete: (endValue?: any) => void;
};
declare type StreamInitializer<T> = (controller: StreamController<T>) => CleanupCallback | void;
declare type StreamOptions<T> = {
    queue?: AbstractQueue<T>;
};
export default class Stream<T> {
    private _state;
    constructor(initializer: StreamInitializer<T>, options?: StreamOptions<T>);
    _createYield(): (value: T) => void;
    _createCompletionMethod(type: 'return' | 'throw'): (value: any) => void;
    _doCleanup(cleanupOperation: CleanupCallback, deferred?: Deferred<void>): Promise<void>;
    next(): Promise<IteratorResult<T>>;
    return(returnValue?: any): Promise<IteratorResult<T>>;
    [Symbol.asyncIterator](): this;
}
export {};
