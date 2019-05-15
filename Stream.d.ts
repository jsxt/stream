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
    enqueue: (value: T) => void;
    dequeue: () => T;
}
export declare class Queue<T> implements AbstractQueue<T> {
    private _queue;
    readonly isEmpty: boolean;
    enqueue(value: T): void;
    dequeue(): T;
}
declare type CleanupCallback = () => any;
declare type WaitingQueue<T> = Queue<Deferred<IteratorResult<T>>['resolver']>;
declare type MaybeQueuedState<T> = {
    name: 'maybeQueued';
    waitingQueue: WaitingQueue<T>;
    itemQueue: AbstractQueue<T>;
    cleanupOperation: CleanupCallback;
};
declare type EndQueuedState<T> = {
    name: 'endQueued';
    itemQueue: AbstractQueue<T>;
    cleanedUp: Promise<void>;
    completionValue: {
        type: 'return' | 'throw';
        value: any;
    };
};
declare type WaitingForValueState<T> = {
    name: 'waitingForValue';
    waitingQueue: WaitingQueue<T>;
    itemQueue: AbstractQueue<T>;
    cleanupOperation: CleanupCallback;
};
declare type WaitingForEndState<T> = {
    name: 'waitingForEnd';
    waitingQueue: WaitingQueue<T>;
    endWaiter: Deferred<IteratorResult<T>>;
    cleanupOperation: CleanupCallback;
};
declare type WaitingForCleanupToFinish = {
    name: 'waitingForCleanupToFinish';
    cleanedUp: Promise<void>;
};
declare type CompleteState = {
    name: 'complete';
};
declare type StreamState<T> = MaybeQueuedState<T> | EndQueuedState<T> | WaitingForValueState<T> | WaitingForEndState<T> | WaitingForCleanupToFinish | CompleteState;
declare type StreamController<T> = {
    [Symbol.toStringTag]: string;
    yield: (value: T) => void;
    next: (value: T) => void;
    throw: (error: any) => void;
    error: (error: any) => void;
    return: (endValue: any) => void;
    complete: (endValue: any) => void;
};
declare type StreamInitializer<T> = (controller: StreamController<T>) => CleanupCallback | void;
declare type StreamOptions<T> = {
    queue?: AbstractQueue<T>;
};
export default class Stream<T> {
    _state: Readonly<StreamState<T>>;
    constructor(initializer: StreamInitializer<T>, options?: StreamOptions<T>);
    _createYield(): (value: T) => void;
    _createCompletionMethod(type: 'return' | 'throw'): (value: any) => void;
    _doCleanup(cleanupOperation: CleanupCallback, deferred?: Deferred<void>): Promise<void>;
    next(): Promise<IteratorResult<T>>;
    return(returnValue?: any): Promise<IteratorResult<T>>;
    [Symbol.asyncIterator](): this;
}
export {};
